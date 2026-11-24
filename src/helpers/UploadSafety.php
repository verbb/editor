<?php
namespace verbb\editor\helpers;

use verbb\editor\errors\UploadRefusedException;

use Craft;
use craft\base\Fs;
use craft\helpers\FileHelper;

use yii\web\UploadedFile;

use Throwable;

/**
 * The rules every file uploaded through Editor meets, whatever a context allows. `CraftAssetProvider`
 * applies them to every upload, and a plugin can call `check()` for uploads that don't go through Editor,
 * such as a front-end Assets field:
 *
 * - SVG, HTML, XML and script files are refused, by extension and by what the file really is, because a
 *   browser can run them from the upload volume's address.
 * - The file's real type, read from its contents, must match its extension, so a page can't be passed
 *   off as an image or a document.
 * - Images lose their metadata, including where they were taken, before they're stored. A phone photo
 *   is turned the way it was taken first, since that's in the metadata too. TIFF images are refused, and
 *   HEIC and AVIF are accepted only when ImageMagick can strip them.
 *
 * Which extensions a context allows, and how large a file may be, are for the caller to check.
 */
final class UploadSafety
{
    // Static Methods
    // =========================================================================

    /**
     * Check `$file` and clean it in place, or refuse it with an `UploadRefusedException` saying why. On
     * success, `$file->type` is the type read from its contents and `$file->size` its size after cleaning.
     * A file that's already clean is left exactly as it is, so checking one again doesn't change it.
     */
    public static function check(UploadedFile $file): void
    {
        if (!is_string($file->tempName) || !is_file($file->tempName)) {
            throw new UploadRefusedException(Craft::t('editor', 'The file could not be uploaded.'), UploadRefusedException::REASON_UPLOAD_FAILED);
        }

        $extension = strtolower(pathinfo((string)$file->name, PATHINFO_EXTENSION));

        if ($extension === '' || self::isBlockedExtension($extension)) {
            throw new UploadRefusedException(Craft::t('editor', 'File type is not permitted.'), UploadRefusedException::REASON_FILE_TYPE);
        }

        // What the file is, from its contents alone: a name can say anything.
        $actual = FileHelper::getMimeType($file->tempName, null, false);
        $actual = is_string($actual) ? strtolower(trim(explode(';', $actual)[0])) : '';

        if ($actual === '') {
            throw new UploadRefusedException(Craft::t('editor', 'Unable to determine the uploaded file type.'), UploadRefusedException::REASON_UNKNOWN_TYPE);
        }

        if (self::isBlockedMimeType($actual)) {
            throw new UploadRefusedException(Craft::t('editor', 'File type is not permitted.'), UploadRefusedException::REASON_FILE_TYPE);
        }

        if (!self::_extensionMatches($extension, $actual)) {
            throw new UploadRefusedException(Craft::t('editor', 'The uploaded file content does not match its extension.'), UploadRefusedException::REASON_MISMATCH);
        }

        if (in_array($actual, ImageMetadata::TIFF_TYPES, true)) {
            throw new UploadRefusedException(Craft::t('editor', 'TIFF images can’t be uploaded. Upload a JPEG or PNG instead.'), UploadRefusedException::REASON_TIFF);
        }

        // HEIC and AVIF can only lose where a photo was taken through ImageMagick, which also reads them.
        if (in_array($actual, ImageMetadata::IMAGICK_TYPES, true)) {
            if (!ImageMetadata::canStripWithImagick($actual)) {
                throw new UploadRefusedException(Craft::t('editor', 'HEIC and AVIF images can only be uploaded when the server has ImageMagick to remove their metadata. Upload a JPEG or PNG instead.'), UploadRefusedException::REASON_NEEDS_IMAGICK);
            }

            if (!ImageMetadata::stripWithImagick($file->tempName, $actual)) {
                throw new UploadRefusedException(Craft::t('editor', 'The uploaded image could not be read.'), UploadRefusedException::REASON_INVALID_IMAGE);
            }
        } elseif (str_starts_with($actual, 'image/')) {
            if (@getimagesize($file->tempName) === false) {
                throw new UploadRefusedException(Craft::t('editor', 'The uploaded image could not be read.'), UploadRefusedException::REASON_INVALID_IMAGE);
            }

            self::_turnUpright($file->tempName, $actual);

            if (!ImageMetadata::strip($file->tempName, $actual)) {
                throw new UploadRefusedException(Craft::t('editor', 'The uploaded image’s metadata could not be removed.'), UploadRefusedException::REASON_METADATA);
            }
        }

        clearstatcache(true, $file->tempName);
        $file->size = (int)filesize($file->tempName);
        $file->type = $actual;
    }

    /**
     * Whether this server can strip HEIC and AVIF images, so they're accepted where a context allows
     * them. A settings page can use this to say whether they'll be refused.
     */
    public static function canStripHeicAndAvif(): bool
    {
        return ImageMetadata::canStripWithImagick('image/heic') && ImageMetadata::canStripWithImagick('image/avif');
    }

    /**
     * Whether Craft's temporary upload filesystem (`tempAssetUploadFs`) has public URLs, so an upload
     * waiting to be saved could be opened by anyone with its address. Editor refuses uploads while it
     * does, and a settings page can use this to warn. A filesystem that can't be read counts as public.
     */
    public static function temporaryUploadsArePublic(): bool
    {
        try {
            $fs = Craft::$app->getAssets()->getTempAssetUploadFs();

            // Every filesystem Craft and its plugins ship extends `Fs`, where public URLs are a setting.
            return $fs instanceof Fs && $fs->hasUrls;
        } catch (Throwable) {
            return true;
        }
    }

    /**
     * Extensions refused whatever is allowed, because a browser can run what they hold: SVG, HTML and
     * XML documents, scripts, and executables.
     */
    public static function isBlockedExtension(string $extension): bool
    {
        return in_array(strtolower(ltrim($extension, '.')), self::BLOCKED_EXTENSIONS, true);
    }

    /**
     * Content types refused whatever the file's name says, for the same reason.
     */
    public static function isBlockedMimeType(string $mimeType): bool
    {
        $mimeType = strtolower($mimeType);

        if (str_ends_with($mimeType, '+xml') || str_contains($mimeType, 'javascript') || str_contains($mimeType, 'ecmascript')) {
            return true;
        }

        return in_array($mimeType, self::BLOCKED_MIME_TYPES, true);
    }

    /**
     * Whether `$extension` names what the contents are. Office documents and other ZIP-based formats
     * are read as ZIP files, and text formats such as CSV are often read as plain text.
     */
    private static function _extensionMatches(string $extension, string $actual): bool
    {
        $expected = FileHelper::getMimeTypeByExtension('file.' . $extension);
        $expected = is_string($expected) ? strtolower($expected) : null;

        if ($expected === $actual || in_array($extension, FileHelper::getExtensionsByMimeType($actual) ?? [], true)) {
            return true;
        }

        if ($actual === 'application/zip' && in_array($extension, ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'zip'], true)) {
            return true;
        }

        if ($actual === 'text/plain' && $expected !== null && str_starts_with($expected, 'text/')) {
            return true;
        }

        // An extension Craft doesn't know can't be checked, so only plain text and unrecognised
        // binary data are let through under one.
        return $expected === null && in_array($actual, ['text/plain', 'application/octet-stream'], true);
    }

    /**
     * Turn a photo the way its metadata says it was taken, as Craft does when it's set to, because
     * removing the metadata would otherwise leave it on its side.
     */
    private static function _turnUpright(string $path, string $mimeType): void
    {
        if ($mimeType !== 'image/jpeg' || !Craft::$app->getConfig()->getGeneral()->rotateImagesOnUploadByExifData) {
            return;
        }

        // Craft goes by the file's extension, which PHP's temporary upload doesn't have.
        $copy = $path . '-upright.jpg';

        try {
            if (copy($path, $copy) && Craft::$app->getImages()->rotateImageByExifData($copy)) {
                rename($copy, $path);
            }
        } catch (Throwable) {
            // The image is still stored, only possibly on its side.
        } finally {
            if (is_file($copy)) {
                @unlink($copy);
            }
        }
    }


    // Constants
    // =========================================================================

    /** Extensions a browser can run, refused whatever a context allows. */
    public const BLOCKED_EXTENSIONS = [
        'svg', 'svgz', 'html', 'htm', 'xhtml', 'xht', 'shtml', 'mht', 'mhtml', 'hta', 'xml', 'xsl', 'xslt', 'rss', 'atom',
        'js', 'mjs', 'cjs', 'jsx', 'ts', 'vbs', 'wsf', 'swf', 'jar', 'jnlp',
        'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'pht', 'phar', 'phps',
        'asp', 'aspx', 'jsp', 'cgi', 'pl', 'py', 'rb', 'sh', 'bash', 'zsh', 'ps1',
        'exe', 'dll', 'com', 'bat', 'cmd', 'msi', 'scr', 'app', 'dmg',
    ];

    /** Content types refused whatever a file's name says, besides any `+xml` or JavaScript type. */
    private const BLOCKED_MIME_TYPES = [
        'text/html', 'text/xml', 'application/xml', 'image/svg+xml', 'application/xhtml+xml', 'message/rfc822',
        'text/x-php', 'application/x-php', 'application/x-httpd-php', 'text/x-shellscript', 'application/x-sh',
        'text/x-python', 'text/x-perl', 'text/x-ruby', 'application/x-shockwave-flash', 'application/java-archive',
        'application/x-msdownload', 'application/x-dosexec', 'application/x-executable', 'application/x-mach-binary',
        'application/hta',
    ];
}
