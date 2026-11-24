<?php

declare(strict_types=1);

use verbb\editor\Editor;
use verbb\editor\enums\AssetKind;
use verbb\editor\errors\UploadRefusedException;
use verbb\editor\helpers\ImageMetadata;
use verbb\editor\helpers\UploadSafety;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use Tests\Support\Factory;

use craft\elements\Asset;

use yii\web\BadRequestHttpException;
use yii\web\UploadedFile;

/**
 * The rules every upload through Editor meets, whatever its context allows: files a browser can run are
 * refused, contents must match the name, and images lose their metadata. Tests that need ImageMagick
 * are skipped where PHP has no Imagick extension.
 */

function safetyContext(array $extensions): EditorConfig
{
    return new EditorConfig([
        'handle' => 'sample.safety',
        'features' => ['image' => true, 'attachment' => true],
        'assets' => new AssetConfig(['enabled' => true, 'volumeId' => Factory::volume()->id, 'allowedExtensions' => $extensions]),
    ]);
}

function safetyFile(string $name, string $contents): UploadedFile
{
    $path = tempnam(sys_get_temp_dir(), 'editor-safety-');
    file_put_contents($path, $contents);

    return new UploadedFile(['name' => $name, 'tempName' => $path, 'type' => 'application/octet-stream', 'size' => strlen($contents), 'error' => UPLOAD_ERR_OK]);
}

function safetyReason(UploadedFile $file): ?string
{
    try {
        UploadSafety::check($file);
    } catch (UploadRefusedException $e) {
        return $e->reason;
    } finally {
        @unlink($file->tempName);
    }

    return null;
}

/**
 * A JPEG carrying where it was taken (an EXIF GPS latitude) and a comment, which is where a page could
 * hide, plus `$orientation` in its first directory when given.
 */
function safetyJpeg(int $width = 4, int $height = 4, ?int $orientation = null): string
{
    $image = imagecreatetruecolor($width, $height);
    ob_start();
    imagejpeg($image);
    $jpeg = (string)ob_get_clean();

    // A little-endian TIFF block whose first directory points at a GPS directory holding a latitude.
    $entries = $orientation !== null ? 2 : 1;
    $gpsOffset = 8 + 2 + 12 * $entries + 4;
    $tiff = 'II' . pack('v', 42) . pack('V', 8)
        . pack('v', $entries)
        . ($orientation !== null ? pack('vvVvv', 0x0112, 3, 1, $orientation, 0) : '')
        . pack('vvVV', 0x8825, 4, 1, $gpsOffset) . pack('V', 0)
        . pack('v', 2)
        . pack('vvV', 0x0001, 2, 2) . "N\0\0\0"
        . pack('vvVV', 0x0002, 5, 3, $gpsOffset + 2 + 24 + 4)
        . pack('V', 0)
        . pack('VVVVVV', 51, 1, 30, 1, 0, 1);
    $payload = "Exif\0\0" . $tiff;
    $segment = "\xFF\xE1" . pack('n', strlen($payload) + 2) . $payload;

    return substr($jpeg, 0, 2) . $segment . "\xFF\xFE" . pack('n', 13) . '<script>' . "\0\0\0" . substr($jpeg, 2);
}

it('refuses files a browser can run, by name and by contents, whatever a context allows', function () {
    $user = Factory::user(['fullName' => 'Safety uploader']);
    Craft::$app->getUser()->setIdentity($user);
    $context = safetyContext(['svg', 'html', 'xml', 'js', 'png', 'txt']);
    $svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    $page = '<!DOCTYPE html><html><body><script>alert(1)</script></body></html>';

    // The context never offers the listed SVG, HTML, XML and script types, and safety refuses the disguised ones.
    foreach ([['drawing.svg', $svg], ['page.html', $page], ['feed.xml', '<?xml version="1.0"?><a/>'], ['app.js', 'alert(1)'], ['pixel.png', $svg], ['notes.txt', $page]] as [$name, $contents]) {
        expect(fn() => Editor::getInstance()->getAssets()->upload(safetyFile($name, $contents), $context, 'attachment'))
            ->toThrow(BadRequestHttpException::class);
    }

    expect(safetyReason(safetyFile('drawing.svg', $svg)))->toBe(UploadRefusedException::REASON_FILE_TYPE)
        ->and(safetyReason(safetyFile('notes.txt', $page)))->toBe(UploadRefusedException::REASON_FILE_TYPE)
        ->and(safetyReason(safetyFile('no-extension', 'plain text')))->toBe(UploadRefusedException::REASON_FILE_TYPE)
        ->and(UploadSafety::isBlockedExtension('.SVG'))->toBeTrue()
        ->and(UploadSafety::isBlockedMimeType('application/rss+xml'))->toBeTrue()
        ->and(UploadSafety::isBlockedMimeType('image/png'))->toBeFalse();
});

it('never offers those file types to the browser, and a list of only those allows nothing', function () {
    expect((new AssetConfig(['allowedExtensions' => ['svg', 'PNG', 'html', 'pdf']]))->getAllowedExtensions(AssetKind::Attachment))->toBe(['png', 'pdf'])
        ->and((new AssetConfig(['allowedExtensions' => ['svg']]))->getAllowedExtensions(AssetKind::InlineImage))->toBe([])
        ->and((new AssetConfig())->getAllowedExtensions(AssetKind::InlineImage))->toBe(AssetConfig::DEFAULT_IMAGE_EXTENSIONS);
});

it('refuses contents that aren’t what the name says', function () {
    expect(safetyReason(safetyFile('photo.png', safetyJpeg())))->toBe(UploadRefusedException::REASON_MISMATCH)
        ->and(safetyReason(safetyFile('data.zzz', Factory::pngBytes())))->toBe(UploadRefusedException::REASON_MISMATCH)
        ->and(safetyReason(safetyFile('notes.csv', "a,b\n1,2\n")))->toBeNull()
        ->and(safetyReason(safetyFile('data.zzz', 'plain text')))->toBeNull();
});

it('accepts text formats whose contents read as plain text', function (string $name, string $contents) {
    expect(safetyReason(safetyFile($name, $contents)))->toBeNull();
})->with([
    'JSON object' => ['data.json', '{"a":1}'],
    'JSON array' => ['data.json', "[1,2,3]\n"],
    'CSV' => ['table.csv', "a,b\n1,2\n"],
    'log' => ['server.log', "2026-11-19 12:00 started\n"],
    'Markdown' => ['notes.md', "# Notes\n\nSome text.\n"],
]);

it('removes where a photo was taken from every upload, keeping the image', function () {
    $user = Factory::user(['fullName' => 'Photo uploader']);
    Craft::$app->getUser()->setIdentity($user);
    $located = safetyJpeg();

    $result = Editor::getInstance()->getAssets()->upload(safetyFile('located.jpg', $located), safetyContext(['jpg']), 'inlineImage');
    $stored = Asset::find()->id($result['id'])->status(null)->one()->getContents();

    expect($located)->toContain("Exif\0\0")->toContain('<script>')
        ->and($stored)->not->toContain("Exif\0\0")->not->toContain('<script>')
        ->and($stored)->toBe(ImageMetadata::stripJpeg($located))
        ->and(@imagecreatefromstring($stored))->not->toBeFalse()
        ->and($result['mimeType'])->toBe('image/jpeg')
        ->and($result['size'])->toBe(strlen($stored));
});

it('sets the file’s type and size from its cleaned contents, and leaves a clean file as it is', function () {
    $file = safetyFile('located.jpg', safetyJpeg());

    try {
        UploadSafety::check($file);
        $clean = (string)file_get_contents($file->tempName);

        expect($file->type)->toBe('image/jpeg')
            ->and($file->size)->toBe(strlen($clean));

        UploadSafety::check($file);

        expect((string)file_get_contents($file->tempName))->toBe($clean);
    } finally {
        @unlink($file->tempName);
    }
});

it('refuses an image it can’t read', function () {
    expect(safetyReason(safetyFile('broken.png', substr(Factory::pngBytes(), 0, 20))))->toBe(UploadRefusedException::REASON_INVALID_IMAGE);
});

it('turns a photo upright before removing the metadata that says which way up it is', function () {
    if (!Craft::$app->getImages()->getIsImagick() || !Craft::$app->getConfig()->getGeneral()->rotateImagesOnUploadByExifData) {
        $this->markTestSkipped('Craft turns photos upright only with ImageMagick.');
    }

    // Orientation 6: taken on its side, so it's shown turned 90° clockwise.
    $file = safetyFile('sideways.jpg', safetyJpeg(8, 4, 6));

    try {
        UploadSafety::check($file);
        [$width, $height] = getimagesize($file->tempName);

        expect([$width, $height])->toBe([4, 8])
            ->and((string)file_get_contents($file->tempName))->not->toContain("Exif\0\0");
    } finally {
        @unlink($file->tempName);
    }
});

it('always refuses TIFF images, whatever is allowed', function () {
    $tiff = "II*\0" . pack('V', 8) . pack('v', 0) . pack('V', 0);

    expect(safetyReason(safetyFile('scan.tif', $tiff)))->toBe(UploadRefusedException::REASON_TIFF);
});

it('refuses HEIC and AVIF with the reason when ImageMagick isn’t there to strip them', function () {
    expect(UploadSafety::canStripHeicAndAvif())->toBe(ImageMetadata::canStripWithImagick('image/heic') && ImageMetadata::canStripWithImagick('image/avif'));

    if (ImageMetadata::canStripWithImagick('image/heic') || ImageMetadata::canStripWithImagick('image/avif')) {
        $this->markTestSkipped('This PHP has ImageMagick, so HEIC and AVIF are accepted.');
    }

    $avif = pack('N', 28) . 'ftypavif' . pack('N', 0) . 'avifmif1miaf' . pack('N', 8) . 'mdat';
    $heic = pack('N', 24) . 'ftypheic' . pack('N', 0) . 'mif1heic' . pack('N', 8) . 'mdat';

    expect(UploadSafety::canStripHeicAndAvif())->toBeFalse()
        ->and(safetyReason(safetyFile('photo.avif', $avif)))->toBe(UploadRefusedException::REASON_NEEDS_IMAGICK)
        ->and(safetyReason(safetyFile('photo.heic', $heic)))->toBe(UploadRefusedException::REASON_NEEDS_IMAGICK);
});

it('strips where a HEIC or AVIF photo was taken with ImageMagick, and leaves a clean one as it is', function (string $format, string $extension, string $mimeType) {
    if (!ImageMetadata::canStripWithImagick($mimeType)) {
        $this->markTestSkipped('Needs PHP’s Imagick extension with ' . $format . ' support.');
    }

    $image = new Imagick();
    $image->newImage(16, 12, new ImagickPixel('teal'));
    $image->setImageFormat($format);
    $image->setImageProperty('exif:GPSLatitude', '51/1, 30/1, 0/1');
    $image->setImageProperty('comment', 'Taken at home');
    $image->profileImage('xmp', '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>');
    $path = tempnam(sys_get_temp_dir(), 'editor-safety-') . '.' . $extension;
    $image->writeImage($path);
    $image->clear();
    $file = new UploadedFile(['name' => 'photo.' . $extension, 'tempName' => $path, 'type' => $mimeType, 'size' => filesize($path), 'error' => UPLOAD_ERR_OK]);

    try {
        UploadSafety::check($file);
        $stripped = (string)file_get_contents($path);
        $check = new Imagick($path);
        $properties = array_keys($check->getImageProperties('*', true));
        $profiles = array_map('strtolower', array_keys($check->getImageProfiles('*', false)));
        $check->clear();

        // Checked again, as a plugin rechecking a file before it's saved would, it isn't changed.
        UploadSafety::check($file);

        expect(array_filter($properties, static fn(string $name): bool => (bool)preg_match('/^(exif|xmp|iptc|gps):/i', $name)))->toBe([])
            ->and(array_intersect($profiles, ['exif', 'xmp', 'iptc', '8bim']))->toBe([])
            ->and($stripped)->not->toContain('<x:xmpmeta')
            ->and((string)file_get_contents($path))->toBe($stripped);
    } finally {
        @unlink($path);
    }
})->with([
    'HEIC' => ['HEIC', 'heic', 'image/heic'],
    'AVIF' => ['AVIF', 'avif', 'image/avif'],
]);

it('refuses every upload while Craft’s temporary upload filesystem has public URLs', function () {
    $user = Factory::user(['fullName' => 'Public temp uploader']);
    Craft::$app->getUser()->setIdentity($user);
    $handle = 'editorPublicTemp' . bin2hex(random_bytes(3));
    $path = sys_get_temp_dir() . '/' . $handle;
    $filesystem = new craft\fs\Local(['name' => $handle, 'handle' => $handle, 'path' => $path, 'hasUrls' => true, 'url' => 'https://uploads.example.test/']);
    Craft::$app->getFs()->saveFilesystem($filesystem);
    $general = Craft::$app->getConfig()->getGeneral();
    $original = $general->tempAssetUploadFs;

    try {
        expect(UploadSafety::temporaryUploadsArePublic())->toBeFalse();

        $general->tempAssetUploadFs = $handle;
        $refusal = null;

        try {
            Editor::getInstance()->getAssets()->upload(safetyFile('pixel.png', Factory::pngBytes()), safetyContext(['png']), 'inlineImage');
        } catch (UploadRefusedException $e) {
            $refusal = $e;
        }

        expect(UploadSafety::temporaryUploadsArePublic())->toBeTrue()
            ->and($refusal?->reason)->toBe(UploadRefusedException::REASON_TEMPORARY_UPLOADS_PUBLIC)
            ->and($refusal?->getMessage())->toBe('Uploads are turned off on this site, because files waiting to be saved would be public.');

        // Without public URLs on the same filesystem, uploads work again.
        $filesystem->hasUrls = false;
        Craft::$app->getFs()->saveFilesystem($filesystem);

        expect(UploadSafety::temporaryUploadsArePublic())->toBeFalse()
            ->and(Editor::getInstance()->getAssets()->upload(safetyFile('pixel.png', Factory::pngBytes()), safetyContext(['png']), 'inlineImage')['temporary'])->toBeTrue();
    } finally {
        $general->tempAssetUploadFs = $original;
        Craft::$app->getFs()->removeFilesystem($filesystem);
        craft\helpers\FileHelper::removeDirectory($path);
    }
});
