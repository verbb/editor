<?php
namespace verbb\editor\helpers;

use verbb\editor\RichText;

class Normalizer
{
    // Constants
    // =========================================================================

    private const INVISIBLE_CHARS = [
        "\u{200B}",
        "\u{2060}",
        "\u{FEFF}",
    ];

    private const LEGACY_NODE_NAMES = [
        'bullet_list' => 'bulletList',
        'code_block' => 'codeBlock',
        'hard_break' => 'hardBreak',
        'horizontal_rule' => 'horizontalRule',
        'list_item' => 'listItem',
        'ordered_list' => 'orderedList',
    ];

    // Nodes that hold other nodes. Anything else without content is an atom, so custom extensions count too.
    private const STRUCTURAL_NODES = [
        'paragraph',
        'heading',
        'bulletList',
        'orderedList',
        'listItem',
        'blockquote',
        'hardBreak',
    ];


    // Static Methods
    // =========================================================================

    /**
     * Normalize any supported rich text value to a content array (`doc.content`). A string is a
     * document only when it decodes to one; every other string is the author's literal text.
     */
    public static function normalize(mixed $value): array
    {
        if ($value instanceof RichText) {
            return $value->getValue();
        }

        if ($value === null || $value === '') {
            return [];
        }

        if (is_string($value)) {
            $document = self::decodeDocument($value);

            return $document !== null ? self::_normalizeStructure($document) : self::textToContent($value);
        }

        if (is_int($value) || is_float($value)) {
            return self::textToContent((string)$value);
        }

        if (is_object($value)) {
            $value = (array)$value;
        }

        return is_array($value) ? self::_normalizeStructure($value) : [];
    }

    /**
     * The decoded document when a string holds a `doc` object or a non-empty array of objects with
     * a string `type`. `null` otherwise, including for JSON such as `123`, `[1,2]` and `{"a":1}`.
     */
    public static function decodeDocument(string $value): mixed
    {
        $decoded = json_decode($value, true);

        if (!is_array($decoded)) {
            return null;
        }

        if (($decoded['type'] ?? null) === 'doc') {
            return $decoded;
        }

        if ($decoded === [] || !array_is_list($decoded)) {
            return null;
        }

        foreach ($decoded as $node) {
            if (!is_array($node) || !is_string($node['type'] ?? null)) {
                return null;
            }
        }

        return $decoded;
    }

    public static function textToContent(string $text): array
    {
        $text = self::stripInvisibleChars($text);

        if ($text === '') {
            return [];
        }

        $content = [];

        foreach (preg_split('/\r\n|\r|\n/', $text) as $index => $line) {
            if ($index > 0) {
                $content[] = ['type' => 'hardBreak'];
            }

            if ($line !== '') {
                $content[] = ['type' => 'text', 'text' => $line];
            }
        }

        return [['type' => 'paragraph', 'content' => $content]];
    }

    public static function normalizeContentArray(mixed $content): array
    {
        if (!is_array($content)) {
            return [];
        }

        $normalized = [];

        foreach ($content as $node) {
            if ($node === null) {
                continue;
            }

            if (is_array($node) && !isset($node['type']) && isset($node['content']) && is_array($node['content'])) {
                $normalized = array_merge($normalized, self::normalizeContentArray($node['content']));

                continue;
            }

            if (!is_array($node) || !isset($node['type'])) {
                continue;
            }

            if ($node['type'] === 'text') {
                $text = self::stripInvisibleChars((string)($node['text'] ?? ''));

                if ($text === '') {
                    continue;
                }

                $normalized[] = array_merge($node, ['text' => $text]);

                continue;
            }

            if (isset($node['content']) && is_array($node['content'])) {
                $node['content'] = self::normalizeContentArray($node['content']);
            }

            $normalized[] = self::_stripDefaultTextAlign($node);
        }

        return $normalized;
    }

    public static function stripInvisibleChars(string $value): string
    {
        return str_replace(self::INVISIBLE_CHARS, '', $value);
    }

    /**
     * A document is empty when it has no non-whitespace text after stripping invisible characters
     * and no atom. Image-only bodies stay valid. The browser applies the same rule.
     */
    public static function isEmptyContent(array $nodes): bool
    {
        foreach ($nodes as $node) {
            if (!is_array($node)) {
                continue;
            }

            $type = $node['type'] ?? null;

            if ($type === 'text') {
                if (preg_match('/[^\s\p{Z}]/u', self::stripInvisibleChars((string)($node['text'] ?? '')))) {
                    return false;
                }

                continue;
            }

            if (isset($node['content']) && is_array($node['content'])) {
                if (!self::isEmptyContent($node['content'])) {
                    return false;
                }

                continue;
            }

            if (!in_array($type, self::STRUCTURAL_NODES, true)) {
                return false;
            }
        }

        return true;
    }


    // Private Methods
    // =========================================================================

    private static function _normalizeStructure(array $value): array
    {
        $value = self::_normalizeNodeValue($value, true);

        if (($value['type'] ?? null) === 'doc') {
            $value = is_array($value['content'] ?? null) ? $value['content'] : [];
        } elseif (isset($value['type'])) {
            $value = [$value];
        }

        return self::normalizeContentArray($value);
    }

    private static function _normalizeNodeValue(mixed $value, bool $structural): mixed
    {
        if (is_object($value)) {
            $value = (array)$value;
        }

        if (!is_array($value)) {
            return $value;
        }

        $normalized = [];
        $isList = array_is_list($value);

        foreach ($value as $key => $item) {
            // Only node and mark identifiers carry legacy names; attributes and text are data.
            $childIsStructural = $isList ? $structural : in_array($key, ['content', 'marks'], true);

            if (!$isList && $key === 'type' && $structural && is_string($item)) {
                $normalized[$key] = self::LEGACY_NODE_NAMES[$item] ?? $item;

                continue;
            }

            $normalized[$key] = self::_normalizeNodeValue($item, $childIsStructural);
        }

        return $normalized;
    }

    private static function _stripDefaultTextAlign(array $node): array
    {
        $attrs = $node['attrs'] ?? null;

        if (!is_array($attrs)) {
            return $node;
        }

        if (($attrs['textAlign'] ?? null) === 'left') {
            unset($attrs['textAlign']);
        }

        if ($attrs === []) {
            unset($node['attrs']);
        } else {
            $node['attrs'] = $attrs;
        }

        return $node;
    }
}
