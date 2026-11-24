<?php
namespace verbb\editor\services;

use verbb\editor\enums\AssetKind;
use verbb\editor\enums\Capability;
use verbb\editor\integrations\assets\CraftAssetProvider;
use verbb\editor\models\EditorConfig;

use Craft;
use craft\base\Component;
use craft\elements\Asset;
use craft\helpers\Db;

use yii\web\BadRequestHttpException;
use yii\web\ForbiddenHttpException;
use yii\web\UploadedFile;

use DateTime;

class Assets extends Component
{
    // Constants
    // =========================================================================

    private const UPLOAD_TTL_SECONDS = 86400;
    private const DELETE_BATCH_SIZE = 100;
    private const DELETE_MAX_BATCHES = 5;


    // Public Methods
    // =========================================================================

    public function upload(UploadedFile $file, EditorConfig $context, AssetKind|string $kind = AssetKind::InlineImage): array
    {
        $kind = $this->_kind($kind);
        $user = Craft::$app->getUser()->getIdentity();

        if (!$user) {
            throw new ForbiddenHttpException(Craft::t('editor', 'Uploads require an authenticated user.'));
        }

        if (!$context->authorizeUser($user, Capability::Upload)) {
            throw new ForbiddenHttpException(Craft::t('editor', 'You can’t upload files here.'));
        }

        if (!$context->isEnabled($kind->feature())) {
            throw new BadRequestHttpException(Craft::t('editor', 'This type of upload is disabled for this editor context.'));
        }

        return $context->getAssetUploader()->upload($file, $context->assets, $context, $kind);
    }

    /**
     * Moves the actor's temporary uploads into the context's folder and passes through permanent
     * Assets the consumer lists as already associated, so edits keep existing media. Assets
     * already finalised stay put, so a save can retry. Anything else is refused, and every
     * reference is checked before any file moves, so a refusal leaves the uploads where they were.
     */
    public function finalize(array $references, EditorConfig $context, int $actorId, array $associatedAssetIds = []): array
    {
        return $context->getAssetUploader()->finalize($references, $context->assets, $context, $actorId, $associatedAssetIds);
    }

    public function resolve(array $reference, EditorConfig $context, AssetKind|string $kind): ?array
    {
        $kind = $this->_kind($kind);

        if (!$context->isEnabled($kind->feature())) {
            return null;
        }

        return $context->getAssetResolver()->resolve($reference, $context->assets, $context, $kind);
    }

    /**
     * Sweeps abandoned uploads from garbage collection. Craft only removes empty temp folders.
     * The marker scopes this to Editor's files, whatever their context and whether or not it
     * still accepts uploads.
     */
    public function deleteExpiredUploads(): int
    {
        $cutoff = (new DateTime())->modify('-' . self::UPLOAD_TTL_SECONDS . ' seconds');
        $deleted = 0;

        for ($batch = 0; $batch < self::DELETE_MAX_BATCHES; $batch++) {
            $assets = Craft::$app->getAssets()->createTempAssetQuery()
                ->filename(CraftAssetProvider::FILENAME_MARKER . '*')
                ->dateCreated('< ' . Db::prepareDateForDb($cutoff))
                ->status(null)
                ->limit(self::DELETE_BATCH_SIZE)
                ->all();

            foreach ($assets as $asset) {
                /** @var Asset $asset */
                if (Craft::$app->getElements()->deleteElement($asset, true)) {
                    $deleted++;
                }
            }

            if (count($assets) < self::DELETE_BATCH_SIZE) {
                break;
            }
        }

        return $deleted;
    }


    // Private Methods
    // =========================================================================

    private function _kind(AssetKind|string $kind): AssetKind
    {
        if ($kind instanceof AssetKind) {
            return $kind;
        }

        return AssetKind::tryFrom($kind) ?? throw new BadRequestHttpException(Craft::t('editor', 'Unsupported upload kind.'));
    }
}
