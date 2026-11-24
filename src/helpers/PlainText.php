<?php
namespace verbb\editor\helpers;

/**
 * Deterministic plain text, shared with the browser's `contentToPlainText()`: top-level blocks are
 * separated by a blank line, nested blocks and list items by a newline, and inline nodes run together.
 */
class PlainText
{
    // Constants
    // =========================================================================

    private const INLINE_NODES = [
        'text',
        'hardBreak',
        'mention',
    ];

    private const MEDIA_NODES = [
        'editorAsset',
        'attachment',
    ];


    // Static Methods
    // =========================================================================

    public static function render(array $content): string
    {
        return self::_join($content, "\n\n");
    }

    /**
     * How many characters of writing a document holds, the count the browser's `limit` uses: its
     * plain text without image alt text or attachment filenames, in Unicode characters.
     */
    public static function textLength(array $content): int
    {
        $text = array_filter($content, static fn(mixed $node): bool => !is_array($node) || !in_array($node['type'] ?? null, self::MEDIA_NODES, true));

        return mb_strlen(Normalizer::stripInvisibleChars(self::render(array_values($text))));
    }

    private static function _join(array $nodes, string $separator): string
    {
        $blocks = [];
        $run = '';

        foreach ($nodes as $node) {
            if (!is_array($node)) {
                continue;
            }

            if (in_array($node['type'] ?? null, self::INLINE_NODES, true)) {
                $run .= self::_inline($node);

                continue;
            }

            if ($run !== '') {
                $blocks[] = $run;
                $run = '';
            }

            $blocks[] = self::_block($node);
        }

        if ($run !== '') {
            $blocks[] = $run;
        }

        return implode($separator, array_filter($blocks, static fn(string $block): bool => $block !== ''));
    }

    private static function _block(array $node): string
    {
        $type = $node['type'] ?? null;

        if ($type === 'attachment') {
            return Normalizer::stripInvisibleChars((string)($node['attrs']['filename'] ?? ''));
        }

        if ($type === 'editorAsset') {
            return Normalizer::stripInvisibleChars((string)($node['attrs']['alt'] ?? ''));
        }

        return is_array($node['content'] ?? null) ? self::_join($node['content'], "\n") : '';
    }

    private static function _inline(array $node): string
    {
        return match ($node['type']) {
            'text' => Normalizer::stripInvisibleChars((string)($node['text'] ?? '')),
            'hardBreak' => "\n",
            default => '@' . Normalizer::stripInvisibleChars((string)($node['attrs']['label'] ?? '')),
        };
    }
}
