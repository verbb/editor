<?php

declare(strict_types=1);

use verbb\editor\helpers\ImageMetadata;

/**
 * Removing image metadata without re-encoding: each format keeps only what draws the image, and a file
 * that can't be made safe is refused. `UploadSafetyTest` covers the same through real uploads.
 */

it('strips metadata from PNG, WebP and GIF images without re-encoding them', function () {
    $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
    $chunk = static fn(string $type, string $data): string => pack('N', strlen($data)) . $type . $data . pack('N', crc32($type . $data));
    $withText = substr($png, 0, 33) . $chunk('tEXt', "GPS\0Lat 51.5") . $chunk('eXIf', 'II*' . "\0") . $chunk('iTXt', "XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>") . substr($png, 33);
    $stripped = ImageMetadata::stripPng($withText);

    expect($stripped)->toBe($png);

    $vp8x = 'VP8X' . pack('V', 10) . chr(0x0C) . str_repeat("\0", 9);
    $image = 'VP8L' . pack('V', 5) . "\x2F\0\0\0\0" . "\0";
    $exif = 'EXIF' . pack('V', 4) . 'II*' . "\0";
    $xmp = 'XMP ' . pack('V', 3) . 'xmp' . "\0";
    $webp = 'RIFF' . pack('V', 4 + strlen($vp8x . $image . $exif . $xmp)) . 'WEBP' . $vp8x . $image . $exif . $xmp;
    $cleanWebp = ImageMetadata::stripWebp($webp);

    expect($cleanWebp)->not->toContain('EXIF')->not->toContain('XMP ')->not->toContain('xmp')
        ->and(ord($cleanWebp[20]) & 0x0C)->toBe(0)
        ->and(unpack('V', substr($cleanWebp, 4, 4))[1])->toBe(strlen($cleanWebp) - 8);

    $gifImage = imagecreate(1, 1);
    imagecolorallocate($gifImage, 255, 0, 0);
    ob_start();
    imagegif($gifImage);
    $gif = (string)ob_get_clean();
    $lsd = 13 + ((ord($gif[10]) & 0x80) ? 3 * (2 ** ((ord($gif[10]) & 0x07) + 1)) : 0);
    $comment = "\x21\xFE" . chr(9) . 'GPS 51.5N' . "\0";
    $xmpExtension = "\x21\xFF" . chr(11) . 'XMP DataXMP' . chr(3) . 'geo' . "\0";
    $tagged = substr($gif, 0, $lsd) . $comment . $xmpExtension . substr($gif, $lsd);

    expect(ImageMetadata::stripGif($tagged))->toBe($gif)
        ->and(ImageMetadata::stripJpeg('not a jpeg'))->toBeNull()
        ->and(ImageMetadata::stripPng('not a png'))->toBeNull();
});

it('keeps only what draws an image, refusing what it can’t make safe', function () {
    $page = '<html><script>alert(1)</script></html>';
    $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
    $chunk = static fn(string $type, string $data): string => pack('N', strlen($data)) . $type . $data . pack('N', crc32($type . $data));
    $iend = substr($png, -12);

    // PNG: an unknown ancillary chunk and trailing data go; an unknown critical chunk can't be drawn without.
    expect(ImageMetadata::stripPng(substr($png, 0, 33) . $chunk('htMl', $page) . substr($png, 33) . $page))->toBe($png)
        ->and(ImageMetadata::stripPng(substr($png, 0, -12) . $chunk('HTML', $page) . $iend))->toBeNull();

    // JPEG: an extension marker, another application segment, comments and anything after the image go.
    $image = imagecreatetruecolor(2, 2);
    ob_start();
    imagejpeg($image);
    $jpeg = (string)ob_get_clean();
    $segment = static fn(int $marker, string $data): string => "\xFF" . chr($marker) . pack('n', strlen($data) + 2) . $data;
    $tagged = substr($jpeg, 0, 2) . $segment(0xEF, $page) . $segment(0xF5, $page) . $segment(0xFE, $page) . $segment(0xE0, 'JFXX' . "\0" . $page) . substr($jpeg, 2) . $page;
    $clean = ImageMetadata::stripJpeg($tagged);

    expect($clean)->not->toContain('<script>')
        ->and($clean)->toBe(ImageMetadata::stripJpeg($jpeg))
        ->and(str_ends_with((string)$clean, "\xFF\xD9"))->toBeTrue()
        ->and(@imagecreatefromstring((string)$clean))->not->toBeFalse();

    // WebP: an unknown chunk, and anything after the size the RIFF header gives, go.
    $vp8l = 'VP8L' . pack('V', 5) . "\x2F\0\0\0\0" . "\0";
    $unknown = 'HTML' . pack('V', strlen($page)) . $page . (strlen($page) % 2 ? "\0" : '');
    $webp = 'RIFF' . pack('V', 4 + strlen($vp8l . $unknown)) . 'WEBP' . $vp8l . $unknown . $page;

    expect(ImageMetadata::stripWebp($webp))->toBe('RIFF' . pack('V', 4 + strlen($vp8l)) . 'WEBP' . $vp8l);

    // GIF: comments and plain text go.
    $gifImage = imagecreate(1, 1);
    imagecolorallocate($gifImage, 0, 0, 255);
    ob_start();
    imagegif($gifImage);
    $gif = (string)ob_get_clean();
    $lsd = 13 + ((ord($gif[10]) & 0x80) ? 3 * (2 ** ((ord($gif[10]) & 0x07) + 1)) : 0);
    $plainText = "\x21\x01" . chr(12) . str_repeat("\0", 12) . chr(strlen($page)) . $page . "\0";
    $comment = "\x21\xFE" . chr(strlen($page)) . $page . "\0";

    expect(ImageMetadata::stripGif(substr($gif, 0, $lsd) . $plainText . $comment . substr($gif, $lsd) . $page))->toBe($gif);
});
