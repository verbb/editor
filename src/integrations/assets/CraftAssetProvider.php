<?php
namespace verbb\editor\integrations\assets;

use verbb\editor\base\AssetResolverInterface;
use verbb\editor\base\AssetUploaderInterface;
use verbb\editor\enums\AssetKind;
use verbb\editor\errors\UploadRefusedException;
use verbb\editor\helpers\UploadSafety;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;

use Craft;
use craft\elements\Asset;
use craft\elements\User;
use craft\helpers\Assets as AssetsHelper;
use craft\helpers\FileHelper;
use craft\models\VolumeFolder;

use yii\web\BadRequestHttpException;
use yii\web\UploadedFile;

use Throwable;

class CraftAssetProvider implements AssetResolverInterface, AssetUploaderInterface
{
    // Constants
    // =========================================================================

    public const FILENAME_MARKER = 'verbb-editor-';
    public const MAX_PENDING_UPLOADS = 20;

    private const MUTEX_TIMEOUT_SECONDS = 5;


    // Public Methods
    // =========================================================================

    public function upload(UploadedFile $file, AssetConfig $config, EditorConfig $context, AssetKind $kind): array
    {
        $actor = Craft::$app->getUser()->getIdentity();

        if (!$actor) {
            throw new BadRequestHttpException(Craft::t('editor', 'Uploads require an authenticated user.'));
        }

        // Uploads wait on Craft's temporary upload filesystem until a document keeps them, unchecked by
        // anyone. If that filesystem has public URLs, anyone with an address could open one before then.
        if (UploadSafety::temporaryUploadsArePublic()) {
            Craft::warning('Editor refused an upload because Craft’s temporary upload filesystem (the `tempAssetUploadFs` general config setting) has public URLs. Use a filesystem without public URLs for temporary uploads.', __METHOD__);

            throw new UploadRefusedException(Craft::t('editor', 'Uploads are turned off on this site, because files waiting to be saved would be public.'), UploadRefusedException::REASON_TEMPORARY_UPLOADS_PUBLIC);
        }

        $this->_assertUploadPolicy($file, $config, $kind);
        $this->_destination($config);

        // Counting and saving under one lock stops parallel requests all passing the same count.
        $mutex = Craft::$app->getMutex();
        $lockName = 'verbb-editor:upload:' . $actor->id;

        if (!$mutex->acquire($lockName, self::MUTEX_TIMEOUT_SECONDS)) {
            throw new BadRequestHttpException(Craft::t('editor', 'Too many uploads at once. Please try again.'));
        }

        try {
            $asset = $this->_saveTemporaryAsset($file, $actor);
        } finally {
            $mutex->release($lockName);
        }

        return [
            'id' => (int)$asset->id,
            'filename' => $this->_originalFilename($asset->getFilename()),
            'url' => $this->_assetUrl($asset),
            'kind' => $kind->value,
            'mimeType' => $asset->getMimeType(),
            'size' => $asset->size,
            'temporary' => true,
        ];
    }

    public function finalize(array $references, ?AssetConfig $config, EditorConfig $context, int $actorId, array $associatedAssetIds = []): array
    {
        $kinds = [];

        foreach ($references as $reference) {
            $id = is_array($reference) ? filter_var($reference['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) : false;
            $kind = is_array($reference) ? AssetKind::tryFrom((string)($reference['kind'] ?? '')) : null;

            if ($id === false || $kind === null) {
                throw new BadRequestHttpException(Craft::t('editor', 'Invalid asset finalisation reference.'));
            }

            $kinds[$id] = $kind;
        }

        if ($kinds === []) {
            return [];
        }

        $assets = Asset::find()->id(array_keys($kinds))->status(null)->indexBy('id')->all();

        if (count($assets) !== count($kinds)) {
            throw new BadRequestHttpException(Craft::t('editor', 'One or more uploaded assets are unavailable.'));
        }

        $associated = array_map('intval', $associatedAssetIds);
        $folder = null;

        // Check every reference before moving anything. A file move can't be rolled back, so a
        // refusal part way through would otherwise leave earlier uploads moved without a document.
        foreach ($kinds as $id => $kind) {
            /** @var Asset $asset */
            $asset = $assets[$id];

            if ($asset->volumeId === null) {
                // Every upload goes to the same folder, the context's destination.
                $folder = $this->_checkTemporaryAsset($asset, $config, $context, $kind, $actorId);
            } elseif (!in_array($id, $associated, true) && !$this->_isAlreadyFinalized($asset, $config, $actorId)) {
                throw new BadRequestHttpException(Craft::t('editor', 'An uploaded asset can’t be used here.'));
            }
        }

        $result = [];

        foreach ($kinds as $id => $kind) {
            /** @var Asset $asset */
            $asset = $assets[$id];

            if ($asset->volumeId === null) {
                $this->_moveTemporaryAsset($asset, $folder);
            }

            $result[] = [
                'id' => (int)$asset->id,
                'filename' => $asset->getFilename(),
                'url' => $this->_assetUrl($asset),
                'kind' => $kind->value,
                'mimeType' => $asset->getMimeType(),
                'size' => $asset->size,
                'temporary' => false,
            ];
        }

        return $result;
    }

    public function resolve(array $reference, AssetConfig $config, EditorConfig $context, AssetKind $kind): ?array
    {
        return $this->resolveAll(['reference' => $reference + ['kind' => $kind->value]], $config, $context)['reference'] ?? null;
    }

    public function resolveAll(array $references, AssetConfig $config, EditorConfig $context): array
    {
        if (!$config->enabled || !$config->volumeId) {
            return [];
        }

        $ids = [];

        foreach ($references as $reference) {
            $id = (int)($reference['id'] ?? 0);

            if ($id > 0) {
                $ids[$id] = $id;
            }
        }

        if ($ids === []) {
            return [];
        }

        $assets = Asset::find()->id(array_values($ids))->volumeId($config->volumeId)->indexBy('id')->all();
        $resolved = [];

        foreach ($references as $key => $reference) {
            $asset = $assets[(int)($reference['id'] ?? 0)] ?? null;
            $kind = AssetKind::tryFrom((string)($reference['kind'] ?? ''));

            if (!$asset instanceof Asset || $kind === null || ($kind === AssetKind::InlineImage && $asset->kind !== Asset::KIND_IMAGE)) {
                continue;
            }

            if ($context->requireViewPermission && !Craft::$app->getElements()->canView($asset)) {
                continue;
            }

            $url = $this->_assetUrl($asset);

            if ($url) {
                $resolved[$key] = [
                    'id' => (int)$asset->id,
                    'filename' => $asset->getFilename(),
                    'url' => $url,
                    'kind' => $kind->value,
                    'mimeType' => $asset->getMimeType(),
                    'size' => $asset->size,
                ];
            }
        }

        return $resolved;
    }


    // Private Methods
    // =========================================================================

    private function _assertUploadPolicy(UploadedFile $file, AssetConfig $config, AssetKind $kind): void
    {
        if ($file->getHasError()) {
            throw new BadRequestHttpException(Craft::t('editor', 'The file could not be uploaded.'));
        }

        $extension = strtolower($file->getExtension());

        if ($extension === '') {
            throw new BadRequestHttpException(Craft::t('editor', 'Unable to determine the uploaded file type.'));
        }

        if (!in_array($extension, $config->getAllowedExtensions($kind), true)) {
            throw new BadRequestHttpException(Craft::t('editor', 'File type is not permitted.'));
        }

        if ($file->size > $config->getMaxFileSize()) {
            throw new BadRequestHttpException(Craft::t('editor', 'File exceeds the maximum allowed size.'));
        }

        // Whatever the context allows: no file a browser can run, contents that match the name, and
        // images without their metadata. This sets the file's type from its contents.
        UploadSafety::check($file);

        if ($kind === AssetKind::InlineImage && (!str_starts_with((string)$file->type, 'image/') || @getimagesize($file->tempName) === false)) {
            throw new BadRequestHttpException(Craft::t('editor', 'Inline image uploads must contain a valid image.'));
        }
    }

    private function _saveTemporaryAsset(UploadedFile $file, User $actor): Asset
    {
        $temporaryFolder = Craft::$app->getAssets()->getUserTemporaryUploadFolder($actor);

        $pending = Craft::$app->getAssets()->createTempAssetQuery()
            ->folderId($temporaryFolder->id)
            ->filename(self::FILENAME_MARKER . '*')
            ->status(null)
            ->count();

        if ($pending >= self::MAX_PENDING_UPLOADS) {
            throw new BadRequestHttpException(Craft::t('editor', 'The maximum number of temporary uploads has been reached.'));
        }

        $originalFilename = AssetsHelper::prepareAssetName($file->name);

        // Ownership is the uploader and their temp folder. The marker only lets GC find Editor's
        // files, and only exists until finalisation renames the Asset back to the original filename.
        $asset = new Asset();
        $asset->tempFilePath = $file->tempName;
        $asset->setFilename(self::FILENAME_MARKER . bin2hex(random_bytes(8)) . '-' . $originalFilename);
        $asset->setMimeType(FileHelper::getMimeType($file->tempName, checkExtension: false));
        $asset->newFolderId = $temporaryFolder->id;
        $asset->setVolumeId($temporaryFolder->volumeId);
        $asset->uploaderId = (int)$actor->id;
        $asset->title = AssetsHelper::filename2Title(pathinfo($originalFilename, PATHINFO_FILENAME));
        $asset->avoidFilenameConflicts = true;
        $asset->setScenario(Asset::SCENARIO_CREATE);

        if (!Craft::$app->getElements()->saveElement($asset)) {
            throw new BadRequestHttpException(Craft::t('editor', 'Unable to save the uploaded file.'));
        }

        return $asset;
    }

    /**
     * Refuses a temporary upload this actor and context can't finalise, and returns the folder it
     * would move into.
     */
    private function _checkTemporaryAsset(Asset $asset, ?AssetConfig $config, EditorConfig $context, AssetKind $kind, int $actorId): VolumeFolder
    {
        $actor = Craft::$app->getUsers()->getUserById($actorId);

        if (!$actor
            || (int)$asset->uploaderId !== $actorId
            || !str_starts_with($asset->getFilename(), self::FILENAME_MARKER)
            || (int)$asset->folderId !== (int)Craft::$app->getAssets()->getUserTemporaryUploadFolder($actor)->id
        ) {
            throw new BadRequestHttpException(Craft::t('editor', 'An uploaded asset can’t be used here.'));
        }

        if ($config === null || !$context->isEnabled($kind->feature())) {
            throw new BadRequestHttpException(Craft::t('editor', 'This type of upload is disabled for this editor context.'));
        }

        // The upload may have come through a different context, so this context's policy decides.
        if (!in_array(strtolower($asset->getExtension()), $config->getAllowedExtensions($kind), true)
            || $asset->size > $config->getMaxFileSize()
            || ($kind === AssetKind::InlineImage && $asset->kind !== Asset::KIND_IMAGE)
        ) {
            throw new BadRequestHttpException(Craft::t('editor', 'File type is not permitted.'));
        }

        [, $folder] = $this->_destination($config);

        return $folder;
    }

    private function _moveTemporaryAsset(Asset $asset, VolumeFolder $folder): void
    {
        $asset->avoidFilenameConflicts = true;

        if (!Craft::$app->getAssets()->moveAsset($asset, $folder, $this->_originalFilename($asset->getFilename()))) {
            throw new BadRequestHttpException(Craft::t('editor', 'Unable to finalise an uploaded file.'));
        }
    }

    /**
     * Lets a save retry after an earlier attempt moved the file but failed later on. The uploader
     * and destination must both match, so this can't be used to claim someone else's Asset.
     */
    private function _isAlreadyFinalized(Asset $asset, ?AssetConfig $config, int $actorId): bool
    {
        if ($config === null || !$config->volumeId || (int)$asset->uploaderId !== $actorId) {
            return false;
        }

        [, $folder] = $this->_destination($config);

        return (int)$asset->folderId === (int)$folder->id;
    }

    private function _destination(AssetConfig $config): array
    {
        $volume = $config->volumeId ? Craft::$app->getVolumes()->getVolumeById($config->volumeId) : null;

        if (!$volume) {
            throw new BadRequestHttpException(Craft::t('editor', 'The upload volume for this editor context is unavailable.'));
        }

        /** @var VolumeFolder|null $folder */
        $folder = $config->folderId
            ? Craft::$app->getAssets()->getFolderById($config->folderId)
            : Craft::$app->getAssets()->getRootFolderByVolumeId($volume->id);

        if (!$folder || (int)$folder->volumeId !== (int)$volume->id) {
            throw new BadRequestHttpException(Craft::t('editor', 'The upload folder for this editor context is unavailable.'));
        }

        return [$volume, $folder];
    }

    private function _originalFilename(string $filename): string
    {
        return preg_replace('/^' . preg_quote(self::FILENAME_MARKER, '/') . '[a-f0-9]{16}-/', '', $filename) ?? $filename;
    }

    private function _assetUrl(Asset $asset): ?string
    {
        try {
            return $asset->getUrl();
        } catch (Throwable) {
            return null;
        }
    }
}
