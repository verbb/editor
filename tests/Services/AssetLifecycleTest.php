<?php

declare(strict_types=1);

use verbb\editor\Editor;
use verbb\editor\enums\AssetKind;
use verbb\editor\integrations\assets\CraftAssetProvider;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use Tests\Support\Factory;

use craft\elements\Asset;
use craft\helpers\Db;
use craft\services\Gc;

use yii\base\Event;
use yii\web\BadRequestHttpException;
use yii\web\ForbiddenHttpException;

function uploadConfig(array $assets = [], array $settings = []): EditorConfig
{
    return new EditorConfig($settings + [
        'handle' => 'sample.upload',
        'features' => ['image' => true, 'attachment' => true],
        'assets' => new AssetConfig($assets + ['enabled' => true, 'volumeId' => Factory::volume()->id, 'allowedExtensions' => ['png', 'txt']]),
    ]);
}

function asUploader(): craft\elements\User
{
    $user = Factory::user(['fullName' => 'Uploader']);
    Craft::$app->getUser()->setIdentity($user);

    return $user;
}

function assetRow(int $id): ?Asset
{
    return Asset::find()->id($id)->status(null)->one();
}

it('uploads as a marked temporary asset owned by the uploader', function () {
    $user = asUploader();
    $result = Editor::getInstance()->getAssets()->upload(Factory::uploadedImage('holiday photo.png'), uploadConfig());
    $asset = assetRow($result['id']);

    expect($result)->toMatchArray(['filename' => 'holiday-photo.png', 'kind' => 'inlineImage', 'temporary' => true, 'mimeType' => 'image/png']);
    expect($asset->volumeId)->toBeNull();
    expect((int)$asset->uploaderId)->toBe((int)$user->id);
    expect($asset->getFilename())->toMatch('/^verbb-editor-[a-f0-9]{16}-holiday-photo\.png$/');
    expect((int)$asset->folderId)->toBe((int)Craft::$app->getAssets()->getUserTemporaryUploadFolder($user)->id);
});

it('checks authorize, login and the feature before uploading', function () {
    $assets = Editor::getInstance()->getAssets();
    $file = Factory::uploadedImage();

    expect(fn() => $assets->upload($file, uploadConfig()))->toThrow(ForbiddenHttpException::class);

    asUploader();

    expect(fn() => $assets->upload($file, uploadConfig(settings: ['authorize' => static fn() => false])))->toThrow(ForbiddenHttpException::class);
    expect(fn() => $assets->upload($file, uploadConfig(['enabled' => false])))->toThrow(BadRequestHttpException::class);
    expect(fn() => $assets->upload($file, uploadConfig(), 'nonsense'))->toThrow(BadRequestHttpException::class);

    $imageOff = uploadConfig();
    $imageOff->features['image'] = false;

    expect(fn() => $assets->upload($file, $imageOff, AssetKind::InlineImage))->toThrow(BadRequestHttpException::class);
    expect($assets->upload(Factory::uploadedFile('notes.txt'), $imageOff, AssetKind::Attachment)['kind'])->toBe('attachment');
});

it('applies upload policy defaults', function () {
    asUploader();
    $assets = Editor::getInstance()->getAssets();
    $defaults = uploadConfig(['allowedExtensions' => []]);

    expect($assets->upload(Factory::uploadedImage(), $defaults)['kind'])->toBe('inlineImage');
    // Attachments have no default list, so a context must name what it accepts.
    expect(fn() => $assets->upload(Factory::uploadedFile('notes.txt'), $defaults, 'attachment'))->toThrow(BadRequestHttpException::class, 'File type is not permitted.');
    expect(fn() => $assets->upload(Factory::uploadedFile('notes.txt'), uploadConfig(['allowedExtensions' => ['pdf']]), 'attachment'))->toThrow(BadRequestHttpException::class, 'File type is not permitted.');
    expect(fn() => $assets->upload(Factory::uploadedImage(), uploadConfig(['maxFileSize' => 1])))->toThrow(BadRequestHttpException::class, 'File exceeds the maximum allowed size.');
    expect(fn() => $assets->upload(Factory::uploadedFile('fake.png', 'not an image'), uploadConfig()))->toThrow(BadRequestHttpException::class);
    expect(fn() => $assets->upload(Factory::uploadedFile('fake.png', '<?php echo 1;'), uploadConfig(), 'attachment'))->toThrow(BadRequestHttpException::class);

    $limit = (int)craft\helpers\ConfigHelper::sizeInBytes(Craft::$app->getConfig()->getGeneral()->maxUploadFileSize);

    expect((new AssetConfig())->getMaxFileSize())->toBe($limit);
    expect((new AssetConfig(['maxFileSize' => $limit * 2]))->getMaxFileSize())->toBe($limit);
    expect((new AssetConfig())->getAllowedExtensions(AssetKind::InlineImage))->toBe(['jpg', 'jpeg', 'png', 'gif', 'webp']);
    expect((new AssetConfig())->getAllowedExtensions(AssetKind::Attachment))->toBe([]);
});

it('caps pending uploads per user across contexts', function () {
    $user = asUploader();
    $assets = Editor::getInstance()->getAssets();
    $folder = Craft::$app->getAssets()->getUserTemporaryUploadFolder($user);

    for ($i = 0; $i < CraftAssetProvider::MAX_PENDING_UPLOADS; $i++) {
        $assets->upload(Factory::uploadedFile("n{$i}.txt"), uploadConfig(settings: ['handle' => 'sample.c' . ($i % 3)]), 'attachment');
    }

    expect((int)Craft::$app->getAssets()->createTempAssetQuery()->folderId($folder->id)->count())->toBe(CraftAssetProvider::MAX_PENDING_UPLOADS);
    expect(fn() => $assets->upload(Factory::uploadedFile('over.txt'), uploadConfig(), 'attachment'))->toThrow(BadRequestHttpException::class, 'maximum number of temporary uploads');

    Craft::$app->getUser()->setIdentity(Factory::user());
    expect($assets->upload(Factory::uploadedFile('other.txt'), uploadConfig(), 'attachment')['temporary'])->toBeTrue();
});


it('finalises under the original filename into the configured folder', function () {
    $user = asUploader();
    $volume = Factory::volume();
    $folder = Factory::subfolder($volume, 'finals');
    $config = uploadConfig(['folderId' => $folder->id]);
    $assets = Editor::getInstance()->getAssets();
    $upload = $assets->upload(Factory::uploadedImage('final.png'), $config);

    $result = $assets->finalize([['id' => $upload['id'], 'kind' => 'inlineImage']], $config, (int)$user->id);
    $asset = assetRow($upload['id']);

    expect($result[0])->toMatchArray(['id' => $upload['id'], 'kind' => 'inlineImage', 'temporary' => false]);
    expect((int)$asset->volumeId)->toBe((int)$volume->id);
    expect((int)$asset->folderId)->toBe((int)$folder->id);
    expect($asset->getFilename())->toStartWith('final')->not->toContain('verbb-editor-');
    expect($result[0]['filename'])->toBe($asset->getFilename());
    expect($asset->getUrl())->not->toContain('verbb-editor-');
    expect(file_exists($asset->getVolume()->getFs()->path . '/finals/' . $asset->getFilename()))->toBeTrue();
});

it('avoids filename conflicts when finalising', function () {
    $user = asUploader();
    $config = uploadConfig();
    $assets = Editor::getInstance()->getAssets();
    $first = $assets->upload(Factory::uploadedImage('same.png'), $config);
    $second = $assets->upload(Factory::uploadedImage('same.png'), $config);

    $assets->finalize([['id' => $first['id'], 'kind' => 'inlineImage']], $config, (int)$user->id);
    $assets->finalize([['id' => $second['id'], 'kind' => 'inlineImage']], $config, (int)$user->id);

    expect(assetRow($first['id'])->getFilename())->not->toBe(assetRow($second['id'])->getFilename());
});

it('is idempotent for the same actor and context', function () {
    $user = asUploader();
    $config = uploadConfig();
    $assets = Editor::getInstance()->getAssets();
    $upload = $assets->upload(Factory::uploadedImage(), $config);
    $references = [['id' => $upload['id'], 'kind' => 'inlineImage']];

    $first = $assets->finalize($references, $config, (int)$user->id);
    $second = $assets->finalize($references, $config, (int)$user->id);

    expect($second)->toBe($first);
    expect($assets->finalize([], $config, (int)$user->id))->toBe([]);
});

it('keeps retained media when another context or a moderator edits', function () {
    $author = asUploader();
    $reply = uploadConfig(settings: ['handle' => 'sample.reply']);
    $edit = uploadConfig(settings: ['handle' => 'sample.edit']);
    $assets = Editor::getInstance()->getAssets();
    $upload = $assets->upload(Factory::uploadedImage(), $reply);
    $references = [['id' => $upload['id'], 'kind' => 'inlineImage']];
    $assets->finalize($references, $reply, (int)$author->id);

    // The same author editing through a second context.
    expect($assets->finalize($references, $edit, (int)$author->id, [$upload['id']])[0]['id'])->toBe($upload['id']);

    // A moderator keeps someone else's media because the consumer lists it as associated.
    $moderator = Factory::user();
    expect($assets->finalize($references, $edit, (int)$moderator->id, [$upload['id']])[0]['id'])->toBe($upload['id']);
    expect(fn() => $assets->finalize($references, $edit, (int)$moderator->id))->toThrow(BadRequestHttpException::class);

    // Existing media survives even once uploads have been turned off for the context.
    $off = uploadConfig(['enabled' => false], ['handle' => 'sample.off']);
    expect($assets->finalize($references, $off, (int)$moderator->id, [$upload['id']])[0]['id'])->toBe($upload['id']);
    $none = new EditorConfig(['handle' => 'sample.none']);
    expect($assets->finalize($references, $none, (int)$moderator->id, [$upload['id']])[0]['id'])->toBe($upload['id']);
});

it('renders media uploaded through one context from another after finalising', function () {
    $author = asUploader();
    $reply = uploadConfig(settings: ['handle' => 'sample.reply']);
    $edit = uploadConfig(settings: ['handle' => 'sample.edit']);
    $assets = Editor::getInstance()->getAssets();
    $upload = $assets->upload(Factory::uploadedImage(), $edit);
    $assets->finalize([['id' => $upload['id'], 'kind' => 'inlineImage']], $edit, (int)$author->id);
    Craft::$app->getUser()->setIdentity(null);

    $html = Editor::getInstance()->getDocuments()->toHtml(
        verbb\editor\RichText::from([['type' => 'editorAsset', 'attrs' => ['id' => $upload['id']]]]),
        $reply,
        associatedAssetIds: [$upload['id']],
    );

    expect($html)->toContain('data-editor-asset-id="' . $upload['id'] . '"', 'src="');
});

it('refuses temporary assets that are not the actor’s', function () {
    $owner = asUploader();
    $config = uploadConfig();
    $assets = Editor::getInstance()->getAssets();
    $upload = $assets->upload(Factory::uploadedImage(), $config);
    $references = [['id' => $upload['id'], 'kind' => 'inlineImage']];
    $other = Factory::user();

    expect(fn() => $assets->finalize($references, $config, (int)$other->id))->toThrow(BadRequestHttpException::class);
    // Listing a temporary Asset as associated grants nothing: only the uploader can move it.
    expect(fn() => $assets->finalize($references, $config, (int)$other->id, [$upload['id']]))->toThrow(BadRequestHttpException::class);
    expect(assetRow($upload['id'])->volumeId)->toBeNull();
    expect($assets->finalize($references, $config, (int)$owner->id)[0]['temporary'])->toBeFalse();
});

it('moves nothing when any reference is refused', function () {
    $owner = asUploader();
    $config = uploadConfig();
    $assets = Editor::getInstance()->getAssets();
    $own = $assets->upload(Factory::uploadedImage(), $config);
    $other = Factory::user();
    Craft::$app->getUser()->setIdentity($other);
    $borrowed = $assets->upload(Factory::uploadedImage(), $config);

    // The owner's own upload comes first, so a refusal part way through would already have moved it.
    $references = [
        ['id' => $own['id'], 'kind' => 'inlineImage'],
        ['id' => $borrowed['id'], 'kind' => 'inlineImage'],
    ];

    expect(fn() => $assets->finalize($references, $config, (int)$owner->id))->toThrow(BadRequestHttpException::class);
    expect(assetRow($own['id'])->volumeId)->toBeNull();
    expect(assetRow($borrowed['id'])->volumeId)->toBeNull();

    // Without the borrowed upload, the owner's still finalises.
    expect($assets->finalize([$references[0]], $config, (int)$owner->id)[0]['temporary'])->toBeFalse();
});

it('refuses unmarked temporary assets and invalid references', function () {
    $owner = asUploader();
    $config = uploadConfig();
    $assets = Editor::getInstance()->getAssets();
    $upload = $assets->upload(Factory::uploadedImage(), $config);
    $asset = assetRow($upload['id']);
    Craft::$app->getDb()->createCommand()->update('{{%assets}}', ['filename' => 'renamed.png'], ['id' => $asset->id])->execute();

    expect(fn() => $assets->finalize([['id' => $upload['id'], 'kind' => 'inlineImage']], $config, (int)$owner->id))->toThrow(BadRequestHttpException::class);
    expect(fn() => $assets->finalize([['id' => 'x', 'kind' => 'inlineImage']], $config, (int)$owner->id))->toThrow(BadRequestHttpException::class);
    expect(fn() => $assets->finalize([['id' => 1, 'kind' => 'nope']], $config, (int)$owner->id))->toThrow(BadRequestHttpException::class);
    expect(fn() => $assets->finalize([['id' => 99999999, 'kind' => 'inlineImage']], $config, (int)$owner->id))->toThrow(BadRequestHttpException::class);
});

it('re-checks the finalising context’s file policy', function () {
    $owner = asUploader();
    $relaxed = uploadConfig();
    $assets = Editor::getInstance()->getAssets();

    $text = $assets->upload(Factory::uploadedFile('note.txt'), $relaxed, 'attachment');
    $image = $assets->upload(Factory::uploadedImage(), $relaxed);
    $large = $assets->upload(Factory::uploadedImage('large.png'), $relaxed);

    $strict = uploadConfig(['allowedExtensions' => ['png']], ['handle' => 'sample.strict']);
    $small = uploadConfig(['maxFileSize' => 1], ['handle' => 'sample.small']);
    $imageOff = uploadConfig(settings: ['handle' => 'sample.noimage']);
    $imageOff->features['image'] = false;

    expect(fn() => $assets->finalize([['id' => $text['id'], 'kind' => 'attachment']], $strict, (int)$owner->id))->toThrow(BadRequestHttpException::class);
    expect(fn() => $assets->finalize([['id' => $large['id'], 'kind' => 'inlineImage']], $small, (int)$owner->id))->toThrow(BadRequestHttpException::class);
    expect(fn() => $assets->finalize([['id' => $image['id'], 'kind' => 'inlineImage']], $imageOff, (int)$owner->id))->toThrow(BadRequestHttpException::class);
    expect(fn() => $assets->finalize([['id' => $text['id'], 'kind' => 'inlineImage']], $relaxed, (int)$owner->id))->toThrow(BadRequestHttpException::class);
    expect(assetRow($text['id'])->volumeId)->toBeNull();
});

it('sweeps only expired marked temporary assets on garbage collection', function () {
    $user = asUploader();
    $config = uploadConfig(['enabled' => true]);
    $assets = Editor::getInstance()->getAssets();
    $expired = $assets->upload(Factory::uploadedImage('old.png'), $config);
    $fresh = $assets->upload(Factory::uploadedImage('new.png'), $config);
    $finalised = $assets->upload(Factory::uploadedImage('kept.png'), $config);
    $assets->finalize([['id' => $finalised['id'], 'kind' => 'inlineImage']], $config, (int)$user->id);

    // A temporary upload from something other than Editor is not Editor's to delete.
    $foreign = $assets->upload(Factory::uploadedImage('foreign.png'), $config);
    Craft::$app->getDb()->createCommand()->update('{{%assets}}', ['filename' => 'foreign.png'], ['id' => $foreign['id']])->execute();

    $past = Db::prepareDateForDb(new DateTime('-25 hours'));

    foreach ([$expired['id'], $finalised['id'], $foreign['id']] as $id) {
        Craft::$app->getDb()->createCommand()->update('{{%elements}}', ['dateCreated' => $past], ['id' => $id])->execute();
    }

    // Fired directly so only Editor's handler runs against this data. No context is registered.
    Event::trigger(Gc::class, Gc::EVENT_RUN);

    expect(assetRow($expired['id']))->toBeNull();
    expect(assetRow($fresh['id']))->not->toBeNull();
    expect(assetRow($finalised['id']))->not->toBeNull();
    expect(assetRow($foreign['id']))->not->toBeNull();
    expect(Editor::getInstance()->getEditorConfigs()->getAllConfigs())->toBe([]);
});

