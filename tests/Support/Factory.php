<?php

declare(strict_types=1);

namespace Tests\Support;

use Craft;
use craft\elements\Entry;
use craft\elements\User;
use craft\fs\Local;
use craft\models\EntryType;
use craft\models\Section;
use craft\models\Section_SiteSettings;
use craft\models\Volume;
use craft\models\VolumeFolder;

use yii\web\UploadedFile;

use RuntimeException;

/**
 * Fixtures for the disposable test database. ResetTestDatabase removes what these create.
 */
final class Factory
{
    public const EMAIL_DOMAIN = 'editor-tests.test';
    public const PASSWORD = 'test-password-123';

    private const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    private static int $sequence = 0;

    public static function user(array $attributes = []): User
    {
        $handle = 'member' . bin2hex(random_bytes(4));
        $user = new User();
        $user->username = $attributes['username'] ?? $handle;
        $user->email = $attributes['email'] ?? $handle . '@' . self::EMAIL_DOMAIN;
        $user->fullName = $attributes['fullName'] ?? null;
        $user->newPassword = self::PASSWORD;
        $user->active = $attributes['active'] ?? true;
        $user->pending = false;

        if (!Craft::$app->getElements()->saveElement($user, false)) {
            throw new RuntimeException('Unable to save test user: ' . implode(' ', $user->getFirstErrors()));
        }

        if ($attributes['suspended'] ?? false) {
            Craft::$app->getUsers()->suspendUser($user);
        }

        return $user;
    }

    public static function volume(string $handle = 'editorTest'): Volume
    {
        $volumes = Craft::$app->getVolumes();
        $volume = $volumes->getVolumeByHandle($handle);

        if ($volume) {
            return $volume;
        }

        // Craft refuses Local filesystems inside the project root.
        $path = sys_get_temp_dir() . '/editor-test-volumes/' . $handle;

        if (!is_dir($path)) {
            mkdir($path, 0775, true);
        }

        $fs = new Local([
            'name' => $handle,
            'handle' => $handle . 'Fs',
            'hasUrls' => true,
            'url' => '/test-volumes/' . $handle,
            'path' => $path,
        ]);

        if (!Craft::$app->getFs()->saveFilesystem($fs)) {
            throw new RuntimeException('Unable to save test filesystem: ' . implode(' ', $fs->getFirstErrors()));
        }

        $volume = new Volume([
            'name' => $handle,
            'handle' => $handle,
        ]);
        $volume->setFsHandle($fs->handle);

        if (!$volumes->saveVolume($volume)) {
            throw new RuntimeException('Unable to save test volume: ' . implode(' ', $volume->getFirstErrors()));
        }

        Craft::$app->getProjectConfig()->saveModifiedConfigData();

        return $volumes->getVolumeByHandle($handle);
    }

    public static function subfolder(Volume $volume, string $name): VolumeFolder
    {
        $assets = Craft::$app->getAssets();
        $root = $assets->getRootFolderByVolumeId($volume->id);
        $folder = $assets->findFolder(['volumeId' => $volume->id, 'name' => $name, 'parentId' => $root->id]);

        if ($folder) {
            return $folder;
        }

        $folder = new VolumeFolder([
            'parentId' => $root->id,
            'volumeId' => $volume->id,
            'name' => $name,
            'path' => $name . '/',
        ]);
        $assets->createFolder($folder);

        return $folder;
    }

    /**
     * A channel whose entries have URLs, for Craft link tests.
     */
    public static function section(string $handle = 'editorNews'): Section
    {
        $entries = Craft::$app->getEntries();
        $section = $entries->getSectionByHandle($handle);

        if ($section) {
            return $section;
        }

        $type = new EntryType(['name' => $handle, 'handle' => $handle . 'Type']);

        if (!$entries->saveEntryType($type)) {
            throw new RuntimeException('Unable to save test entry type: ' . implode(' ', $type->getFirstErrors()));
        }

        $siteId = Craft::$app->getSites()->getPrimarySite()->id;
        $section = new Section([
            'name' => $handle,
            'handle' => $handle,
            'type' => Section::TYPE_CHANNEL,
            'siteSettings' => [
                $siteId => new Section_SiteSettings([
                    'siteId' => $siteId,
                    'hasUrls' => true,
                    'uriFormat' => $handle . '/{slug}',
                    'template' => 'index',
                ]),
            ],
        ]);
        $section->setEntryTypes([$type]);

        if (!$entries->saveSection($section)) {
            throw new RuntimeException('Unable to save test section: ' . implode(' ', $section->getFirstErrors()));
        }

        Craft::$app->getProjectConfig()->saveModifiedConfigData();

        return $entries->getSectionByHandle($handle);
    }

    public static function entry(Section $section, string $title, bool $enabled = true): Entry
    {
        $entry = new Entry();
        $entry->sectionId = $section->id;
        $entry->typeId = $section->getEntryTypes()[0]->id;
        $entry->title = $title;
        $entry->slug = strtolower(str_replace(' ', '-', $title)) . '-' . ++self::$sequence . bin2hex(random_bytes(2));
        $entry->enabled = $enabled;

        if (!Craft::$app->getElements()->saveElement($entry)) {
            throw new RuntimeException('Unable to save test entry: ' . implode(' ', $entry->getFirstErrors()));
        }

        return $entry;
    }

    public static function uploadedImage(string $name = 'photo.png'): UploadedFile
    {
        return self::uploadedFile($name, base64_decode(self::PNG_BASE64), 'image/png');
    }

    public static function uploadedFile(string $name, string $contents = 'plain text', string $type = 'text/plain'): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'editor-upload-');
        file_put_contents($path, $contents);

        return new UploadedFile([
            'name' => $name,
            'tempName' => $path,
            'type' => $type,
            'size' => strlen($contents),
            'error' => UPLOAD_ERR_OK,
        ]);
    }

    public static function pngBytes(): string
    {
        return base64_decode(self::PNG_BASE64);
    }
}
