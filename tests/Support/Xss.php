<?php

declare(strict_types=1);

namespace Tests\Support;

use verbb\editor\base\AssetResolverInterface;
use verbb\editor\base\ElementProviderInterface;
use verbb\editor\base\MentionProviderInterface;
use verbb\editor\enums\AssetKind;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\ElementLinkConfig;
use verbb\editor\models\MentionConfig;

/**
 * The XSS corpus in `tests/fixtures/xss.json`, a context with every feature on whose providers hand
 * back hostile values, and the check every rendered document must pass.
 */
final class Xss
{
    /**
     * Everything Editor's PHP renderer can produce, and the attributes each element may carry.
     */
    public const ALLOWED = [
        'p' => [],
        'h1' => [],
        'h2' => [],
        'h3' => [],
        'h4' => [],
        'h5' => [],
        'h6' => [],
        'ul' => [],
        'ol' => ['start'],
        'li' => [],
        'blockquote' => [],
        'strong' => [],
        'em' => [],
        's' => [],
        'u' => [],
        'code' => [],
        'br' => [],
        'a' => ['href', 'target', 'rel', 'class', 'data-craft-link-id', 'data-craft-link-type', 'data-craft-link-label', 'data-editor-attachment-id', 'data-filename', 'data-mime-type', 'data-size'],
        'img' => ['src', 'alt', 'title', 'data-editor-asset-id'],
        'span' => ['class', 'data-mention-id', 'data-mention-type', 'data-label'],
    ];

    private const URL_ATTRIBUTES = ['href', 'src'];

    public static function corpus(): array
    {
        return json_decode((string)file_get_contents(dirname(__DIR__) . '/fixtures/xss.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    /**
     * Problems with rendered HTML, or an empty array when it's safe. The output must be exactly what
     * the serializer writes: allow-listed tags with double-quoted, fully escaped attribute values,
     * and text with no markup characters. Anything else could parse differently in a browser.
     */
    public static function problems(string $html): array
    {
        $problems = [];
        $offset = 0;
        $length = strlen($html);

        while ($offset < $length) {
            $lt = strpos($html, '<', $offset);
            $text = substr($html, $offset, ($lt === false ? $length : $lt) - $offset);

            if (strpbrk($text, '>"') !== false) {
                $problems[] = "Text holds a raw markup character: {$text}";
            }

            if ($lt === false) {
                break;
            }

            if (!preg_match('/\G<(\/?)([a-z][a-z0-9]*)((?:\s[a-z][a-z0-9-]*="[^"<>]*")*)>/', $html, $match, 0, $lt)) {
                $problems[] = 'Unexpected markup: ' . substr($html, $lt, 80);
                $offset = $lt + 1;

                continue;
            }

            [$tag, $closing, $name, $attributes] = $match;
            $offset = $lt + strlen($tag);

            if (!array_key_exists($name, self::ALLOWED)) {
                $problems[] = "Element <{$name}> isn't allowed.";

                continue;
            }

            if ($closing !== '' && $attributes !== '') {
                $problems[] = "Closing tag with attributes: {$tag}";
            }

            preg_match_all('/\s([a-z][a-z0-9-]*)="([^"]*)"/', $attributes, $pairs, PREG_SET_ORDER);

            foreach ($pairs as [, $attribute, $value]) {
                if (!in_array($attribute, self::ALLOWED[$name], true)) {
                    $problems[] = "Attribute {$attribute} isn't allowed on <{$name}>.";
                }

                if (in_array($attribute, self::URL_ATTRIBUTES, true) && !self::isSafeUrl(self::decodeAttribute($value))) {
                    $problems[] = "Unsafe URL in {$attribute}: {$value}";
                }
            }
        }

        return $problems;
    }

    /**
     * Whether a browser would follow a URL somewhere harmless, checked independently of the
     * sanitiser's rules. The URL parser drops leading and trailing C0 controls and spaces, and tabs
     * and newlines anywhere, before it reads the scheme.
     */
    public static function isSafeUrl(string $url): bool
    {
        $url = preg_replace('/[\t\n\r]/', '', trim($url, "\x00..\x20")) ?? '';

        if (preg_match('/^([a-z][a-z0-9+.-]*):/i', $url, $scheme) && !in_array(strtolower($scheme[1]), ['http', 'https', 'mailto'], true)) {
            return false;
        }

        // A backslash after the scheme position is a slash to the URL parser, so `\\host` leaves the site.
        return !str_starts_with($url, '\\');
    }

    /**
     * An attribute value as a browser reads it. Unlike `html_entity_decode()`, browsers also accept
     * a numeric reference without its semicolon, so `javascript&#58alert(1)` has a colon.
     */
    public static function decodeAttribute(string $value): string
    {
        $value = preg_replace_callback('/&#(?:x([0-9a-f]+)|([0-9]+));?/i', static function(array $match): string {
            $code = $match[1] !== '' ? hexdec($match[1]) : (int)$match[2];

            return $code > 0 && $code <= 0x10FFFF && ($code < 0xD800 || $code > 0xDFFF) ? mb_chr((int)$code, 'UTF-8') : "\u{FFFD}";
        }, $value) ?? $value;

        return html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    /**
     * Every feature on, with providers that return whatever they're given or something hostile, as
     * a careless or compromised provider might.
     */
    public static function hostileContext(array $urls, array $strings): EditorConfig
    {
        $pick = static fn(array $list, int $id): mixed => $list[$id % count($list)];

        return new EditorConfig([
            'handle' => 'xss.everything',
            'features' => [
                'bold' => true, 'italic' => true, 'strike' => true, 'underline' => true, 'headings' => [1, 2, 3, 4, 5, 6],
                'lists' => true, 'blockquote' => true, 'code' => true, 'link' => true, 'craftLink' => true,
                'image' => true, 'attachment' => true, 'mention' => true,
            ],
            'mentions' => new MentionConfig(['enabled' => true]),
            'elementLinks' => new ElementLinkConfig(['enabled' => true]),
            'assets' => new AssetConfig(['enabled' => true]),
            'mentionProvider' => new class($strings, $pick) implements MentionProviderInterface {
                public function __construct(private array $strings, private \Closure $pick)
                {
                }

                public function search(string $query, MentionConfig $config, EditorConfig $context): array
                {
                    return [];
                }

                public function resolve(array $reference, MentionConfig $config, EditorConfig $context): ?array
                {
                    return null;
                }

                public function resolveAll(array $references, MentionConfig $config, EditorConfig $context): array
                {
                    return array_map(fn(array $reference) => $reference + ['label' => ($this->pick)($this->strings, $reference['id'])], $references);
                }
            },
            'elementProvider' => new class($urls, $strings, $pick) implements ElementProviderInterface {
                public function __construct(private array $urls, private array $strings, private \Closure $pick)
                {
                }

                public function search(string $query, ElementLinkConfig $config, EditorConfig $context): array
                {
                    return [];
                }

                public function resolve(array $reference, ElementLinkConfig $config, EditorConfig $context): ?array
                {
                    return null;
                }

                public function resolveAll(array $references, ElementLinkConfig $config, EditorConfig $context): array
                {
                    return array_map(fn(array $reference) => [
                        'id' => $reference['id'],
                        'type' => $reference['type'],
                        'label' => ($this->pick)($this->strings, $reference['id']),
                        'url' => ($this->pick)($this->urls, $reference['id']),
                    ], $references);
                }
            },
            'assetProvider' => new class($urls, $strings, $pick) implements AssetResolverInterface {
                public function __construct(private array $urls, private array $strings, private \Closure $pick)
                {
                }

                public function resolve(array $reference, AssetConfig $config, EditorConfig $context, AssetKind $kind): ?array
                {
                    return null;
                }

                public function resolveAll(array $references, AssetConfig $config, EditorConfig $context): array
                {
                    return array_map(fn(array $reference) => [
                        'id' => $reference['id'],
                        'filename' => ($this->pick)($this->strings, $reference['id']),
                        'url' => ($this->pick)($this->urls, $reference['id']),
                        'mimeType' => ($this->pick)($this->strings, $reference['id'] + 1),
                        'size' => ($this->pick)($this->strings, $reference['id'] + 2),
                    ], $references);
                }
            },
        ]);
    }
}
