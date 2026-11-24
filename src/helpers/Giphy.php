<?php
namespace verbb\editor\helpers;

/**
 * Checks a GIF the browser chose from GIPHY before a host saves it. The browser sends the address as
 * GIPHY gave it, and GIPHY's terms ask that it's used unchanged, so this only confirms it's one of
 * GIPHY's and reads its size.
 */
class Giphy
{
    // Constants
    // =========================================================================

    // GIPHY serves its media from `media.giphy.com`, `media0.giphy.com` to `media4.giphy.com` and
    // `i.giphy.com`, always over HTTPS.
    public const ALLOWED_URL_PATTERN = '#^https://([a-z0-9-]+\.)*giphy\.com/[^\s"\'<>\\\\]+$#i';

    // Longer than any URL GIPHY returns, with its tracking parameters, and short enough to store.
    public const URL_MAX_LENGTH = 2048;

    // Larger than any rendition GIPHY serves.
    private const DIMENSION_MAX = 10000;


    // Public Methods
    // =========================================================================

    public static function isValidUrl(mixed $url): bool
    {
        return is_string($url)
            && strlen($url) <= self::URL_MAX_LENGTH
            && (bool)preg_match(self::ALLOWED_URL_PATTERN, $url);
    }

    /**
     * Reads a GIF as the browser sends it, `{ url, width, height }`, into what to save, or null when
     * it isn't one of GIPHY's. A size that isn't a sensible number is saved as unknown.
     *
     * @return array{url: string, width: ?int, height: ?int}|null
     */
    public static function normalize(mixed $gif): ?array
    {
        if (is_string($gif)) {
            $gif = json_decode($gif, true);
        }

        $url = is_array($gif) ? ($gif['url'] ?? null) : null;

        if (!self::isValidUrl($url)) {
            return null;
        }

        return [
            'url' => $url,
            'width' => self::_dimension($gif['width'] ?? null),
            'height' => self::_dimension($gif['height'] ?? null),
        ];
    }


    // Private Methods
    // =========================================================================

    private static function _dimension(mixed $value): ?int
    {
        if (!is_numeric($value)) {
            return null;
        }

        $value = (int)$value;

        return $value > 0 && $value <= self::DIMENSION_MAX ? $value : null;
    }
}
