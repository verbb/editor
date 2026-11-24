<?php
namespace verbb\editor\helpers;

use verbb\editor\base\ExtensionPolicyInterface;
use verbb\editor\enums\Feature;
use verbb\editor\models\EditorConfig;

use Tiptap\Core\Mark;
use Tiptap\Core\Node;

/**
 * The server's trust boundary for documents: an allow-list of nodes, marks and attributes, the
 * context's feature rules, and the document structure the browser's schema expects. It runs once
 * per boundary on content already normalised by RichText.
 */
class Sanitizer
{
    // Constants
    // =========================================================================

    private const MARK_FEATURES = [
        'bold' => Feature::Bold,
        'italic' => Feature::Italic,
        'strike' => Feature::Strike,
        'underline' => Feature::Underline,
        'code' => Feature::Code,
        'link' => Feature::Link,
        'craftLink' => Feature::CraftLink,
    ];

    private const LINK_MARKS = [
        'link',
        'craftLink',
    ];

    // Untrusted content can add `ugc` but never remove these, which would invite link spam.
    private const LINK_REL = [
        'noopener',
        'noreferrer',
        'nofollow',
    ];

    private const SAFE_LINK_SCHEMES = [
        'http',
        'https',
        'mailto',
    ];

    private const INLINE_NODES = [
        'text',
        'hardBreak',
        'mention',
    ];

    private const BLOCK_NODES = [
        'paragraph',
        'heading',
        'bulletList',
        'orderedList',
        'listItem',
        'blockquote',
        'editorAsset',
        'attachment',
    ];

    private const STRUCTURED_NODES = [
        'mention',
        'editorAsset',
        'attachment',
    ];

    private const CONTAINER_NODES = [
        'bulletList',
        'orderedList',
        'listItem',
        'blockquote',
    ];


    // Static Methods
    // =========================================================================

    public static function sanitize(array $content, ?EditorConfig $config = null): array
    {
        return self::_blocks($content, $config, self::_extensionPolicies($config));
    }

    /**
     * Without a context nothing can vouch for a reference, so each structured node falls back to
     * text: a mention to its label, an image to its alt text, a Craft link to its link text.
     */
    public static function degradeStructuredNodes(array $nodes): array
    {
        return self::mapStructuredNodes($nodes, static function(array $node): ?array {
            if ($node['type'] === 'mention') {
                return self::mentionText($node);
            }

            $alt = $node['type'] === 'editorAsset' ? ($node['attrs']['alt'] ?? '') : '';

            return $alt !== '' ? ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $alt]]] : null;
        }, static fn(array $mark): ?array => null);
    }

    /**
     * Walks sanitised content, replacing each mention, image and attachment through `$node` and each
     * Craft link mark through `$craftLink`. Returning `null` removes it, and any list or blockquote
     * left with no children goes with it.
     */
    public static function mapStructuredNodes(array $nodes, callable $node, callable $craftLink): array
    {
        $mapped = [];

        foreach ($nodes as $current) {
            if (in_array($current['type'] ?? null, self::STRUCTURED_NODES, true)) {
                $current = $node($current);

                if ($current === null) {
                    continue;
                }
            }

            if (isset($current['marks'])) {
                $marks = [];

                foreach ($current['marks'] as $mark) {
                    $mark = $mark['type'] === 'craftLink' ? $craftLink($mark) : $mark;

                    if ($mark !== null) {
                        $marks[] = $mark;
                    }
                }

                unset($current['marks']);

                if ($marks !== []) {
                    $current['marks'] = $marks;
                }
            }

            if (isset($current['content']) && !in_array($current['type'], self::STRUCTURED_NODES, true)) {
                $current['content'] = self::mapStructuredNodes($current['content'], $node, $craftLink);

                if ($current['content'] === [] && in_array($current['type'], self::CONTAINER_NODES, true)) {
                    continue;
                }
            }

            $mapped[] = $current;
        }

        return self::mergeAdjacentText($mapped);
    }

    /**
     * A mention's text form is what the author saw in the editor: its label with the `@`.
     */
    public static function mentionText(array $node): array
    {
        $text = ['type' => 'text', 'text' => '@' . ($node['attrs']['label'] ?? '')];

        return isset($node['marks']) ? $text + ['marks' => $node['marks']] : $text;
    }

    public static function mergeAdjacentText(array $nodes): array
    {
        $merged = [];

        foreach ($nodes as $node) {
            $last = array_key_last($merged);

            if ($last !== null
                && ($node['type'] ?? null) === 'text'
                && ($merged[$last]['type'] ?? null) === 'text'
                && ($merged[$last]['marks'] ?? []) === ($node['marks'] ?? [])
            ) {
                $merged[$last]['text'] .= $node['text'];

                continue;
            }

            $merged[] = $node;
        }

        return $merged;
    }

    public static function isSafeLink(string $href): bool
    {
        $href = self::trimUrl($href);

        // Whitespace and control characters split schemes, and a leading backslash is treated as a slash.
        if ($href === '' || str_starts_with($href, '\\') || preg_match('/[\x00-\x20\x7F]/', $href)) {
            return false;
        }

        $schemeCandidate = preg_split('/[\/?#]/', self::_decodedUrl($href), 2)[0] ?? '';
        $schemeCandidate = preg_replace('/[\x00-\x20\x7F]+/', '', $schemeCandidate) ?? $schemeCandidate;

        if (str_contains($schemeCandidate, ':')) {
            [$scheme] = explode(':', $schemeCandidate, 2);

            return in_array(strtolower($scheme), self::SAFE_LINK_SCHEMES, true);
        }

        return true;
    }

    /**
     * Trims every kind of whitespace, as the browser's `trim()` does, so a URL of only line or
     * paragraph separators is empty on both sides.
     */
    public static function trimUrl(string $url): string
    {
        return preg_replace('/^[\s\p{Z}\x{FEFF}]+|[\s\p{Z}\x{FEFF}]+$/u', '', $url) ?? trim($url);
    }

    public static function isSafeResourceUrl(string $url): bool
    {
        return self::isSafeLink($url) && !str_starts_with(strtolower(self::_decodedUrl($url)), 'mailto:');
    }

    private static function _blocks(array $nodes, ?EditorConfig $config, array $policies): array
    {
        $blocks = [];
        $run = [];

        // Consecutive inline nodes share one paragraph; any block between them ends it.
        foreach ($nodes as $node) {
            if (!is_array($node)) {
                continue;
            }

            foreach (self::_node($node, $config, $policies, true) as $sanitized) {
                if (in_array($sanitized['type'], self::INLINE_NODES, true)) {
                    $run[] = $sanitized;

                    continue;
                }

                if ($run !== []) {
                    $blocks[] = ['type' => 'paragraph', 'content' => $run];
                    $run = [];
                }

                $blocks[] = $sanitized;
            }
        }

        if ($run !== []) {
            $blocks[] = ['type' => 'paragraph', 'content' => $run];
        }

        return $blocks;
    }

    private static function _node(array $node, ?EditorConfig $config, array $policies, bool $blockContext): array
    {
        $type = $node['type'] ?? null;

        if (!is_string($type)) {
            return [];
        }

        $children = is_array($node['content'] ?? null) ? $node['content'] : [];

        if (isset($policies['nodes'][$type])) {
            return self::_customNode($node, $children, $config, $policies, $blockContext);
        }

        switch ($type) {
            case 'text':
                return self::_text($node, $config, $policies);
            case 'hardBreak':
                return [self::_withMarks(['type' => 'hardBreak'], $node, $config, $policies)];
            case 'paragraph':
                return self::_textBlock(['type' => 'paragraph'], $children, $config, $policies);
            case 'heading':
                $level = self::_headingLevel($node['attrs']['level'] ?? null, $config);

                return self::_textBlock($level !== null ? ['type' => 'heading', 'attrs' => ['level' => $level]] : ['type' => 'paragraph'], $children, $config, $policies);
            case 'bulletList':
            case 'orderedList':
                return self::_list($type, $node, $children, $config, $policies);
            case 'listItem':
                // Reached only when the item has no enabled list around it, so each child stands alone.
                return self::_blocks($children, $config, $policies);
            case 'blockquote':
                $blocks = self::_blocks($children, $config, $policies);

                if (!self::_isEnabled(Feature::Blockquote, $config)) {
                    return $blocks;
                }

                return $blocks === [] ? [] : [['type' => 'blockquote', 'content' => $blocks]];
            case 'mention':
                return self::_mention($node, $config, $policies);
            case 'editorAsset':
                return self::_asset('editorAsset', Feature::Image, $node, $config);
            case 'attachment':
                return self::_asset('attachment', Feature::Attachment, $node, $config);
        }

        // Unknown wrappers keep their useful children. Block context keeps each wrapper's text separate.
        if ($blockContext) {
            return self::_blocks($children, $config, $policies);
        }

        return self::_inlineChildren($children, $config, $policies);
    }

    private static function _customNode(array $node, array $children, ?EditorConfig $config, array $policies, bool $blockContext): array
    {
        $attrs = $policies['nodes'][$node['type']]->sanitizeAttributes(is_array($node['attrs'] ?? null) ? $node['attrs'] : []);

        if ($attrs === null) {
            return $blockContext ? self::_blocks($children, $config, $policies) : self::_inlineChildren($children, $config, $policies);
        }

        $sanitized = ['type' => $node['type']];

        if ($attrs !== []) {
            $sanitized['attrs'] = $attrs;
        }

        if (isset($node['content'])) {
            // A custom node's content model is its own, so its children are cleaned but not wrapped.
            $sanitized['content'] = self::_inlineChildren($children, $config, $policies);
        }

        return [self::_withMarks($sanitized, $node, $config, $policies)];
    }

    /**
     * Paragraph-like nodes hold inline content only. A block nested inside one is lifted out after
     * the text before it, so `<p><p>nested</p></p>` can't reach the renderer.
     */
    private static function _textBlock(array $block, array $children, ?EditorConfig $config, array $policies): array
    {
        $result = [];
        $run = [];

        foreach (self::_inlineChildren($children, $config, $policies) as $child) {
            // Custom nodes declare no group, so one written inside a paragraph stays there.
            if (!in_array($child['type'], self::BLOCK_NODES, true)) {
                $run[] = $child;

                continue;
            }

            if ($run !== []) {
                $result[] = $block + ['content' => $run];
                $run = [];
            }

            $result[] = $child;
        }

        if ($run !== [] || $result === []) {
            $result[] = $run !== [] ? $block + ['content' => $run] : $block;
        }

        return $result;
    }

    private static function _inlineChildren(array $children, ?EditorConfig $config, array $policies): array
    {
        $result = [];

        foreach ($children as $child) {
            if (is_array($child)) {
                array_push($result, ...self::_node($child, $config, $policies, false));
            }
        }

        return $result;
    }

    private static function _list(string $type, array $node, array $children, ?EditorConfig $config, array $policies): array
    {
        if (!self::_isEnabled(Feature::Lists, $config)) {
            return self::_blocks($children, $config, $policies);
        }

        $items = [];

        foreach ($children as $child) {
            if (!is_array($child)) {
                continue;
            }

            // Anything directly under a list becomes an item, because the schema allows nothing else.
            $blocks = self::_blocks(($child['type'] ?? null) === 'listItem' && is_array($child['content'] ?? null) ? $child['content'] : [$child], $config, $policies);

            if (($blocks[0]['type'] ?? null) !== 'paragraph') {
                array_unshift($blocks, ['type' => 'paragraph']);
            }

            $items[] = ['type' => 'listItem', 'content' => $blocks];
        }

        if ($items === []) {
            return [];
        }

        $list = ['type' => $type];
        $start = filter_var($node['attrs']['start'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        if ($type === 'orderedList' && $start !== false) {
            $list['attrs'] = ['start' => $start];
        }

        $list['content'] = $items;

        return [$list];
    }

    private static function _mention(array $node, ?EditorConfig $config, array $policies): array
    {
        $attrs = is_array($node['attrs'] ?? null) ? $node['attrs'] : [];
        $id = filter_var($attrs['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $type = self::_safeIdentifier($attrs['type'] ?? null);
        $label = self::_safeLabel($attrs['label'] ?? null);

        if ($label === null) {
            return [];
        }

        // A disabled or broken mention keeps what the author could read.
        if ($id === false || $type === null || !self::_isEnabled(Feature::Mention, $config)) {
            return [self::mentionText(['attrs' => ['label' => $label]])];
        }

        return [self::_withMarks(['type' => 'mention', 'attrs' => ['id' => $id, 'type' => $type, 'label' => $label]], $node, $config, $policies)];
    }

    private static function _asset(string $type, Feature $feature, array $node, ?EditorConfig $config): array
    {
        if (!self::_isEnabled($feature, $config)) {
            return [];
        }

        $attrs = is_array($node['attrs'] ?? null) ? $node['attrs'] : [];
        $id = filter_var($attrs['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        if ($id === false) {
            return [];
        }

        // Stored references carry identity and authored text only. URLs and file details always
        // come from resolution, because a stored one could be forged or go stale.
        $clean = ['id' => $id];

        if ($type === 'editorAsset') {
            foreach (['alt', 'title'] as $key) {
                $value = self::_safeLabel($attrs[$key] ?? null);

                if ($value !== null) {
                    $clean[$key] = $value;
                }
            }
        }

        return [['type' => $type, 'attrs' => $clean]];
    }

    private static function _text(array $node, ?EditorConfig $config, array $policies): array
    {
        $text = Normalizer::stripInvisibleChars((string)($node['text'] ?? ''));

        if ($text === '') {
            return [];
        }

        return [self::_withMarks(['type' => 'text', 'text' => $text], $node, $config, $policies)];
    }

    private static function _withMarks(array $sanitized, array $node, ?EditorConfig $config, array $policies): array
    {
        $marks = self::_marks($node['marks'] ?? null, $config, $policies);

        if ($marks !== []) {
            $sanitized['marks'] = $marks;
        }

        return $sanitized;
    }

    private static function _marks(mixed $marks, ?EditorConfig $config, array $policies): array
    {
        if (!is_array($marks)) {
            return [];
        }

        $sanitized = [];

        foreach ($marks as $mark) {
            if (!is_array($mark) || !is_string($mark['type'] ?? null)) {
                continue;
            }

            $clean = self::_mark($mark['type'], is_array($mark['attrs'] ?? null) ? $mark['attrs'] : [], $config, $policies);

            if ($clean === null) {
                continue;
            }

            // A mark appears once per node, and a link holds no other link. tiptap-php can't render a
            // repeated mark, and a link inside a link is markup a browser would rearrange.
            $kind = in_array($clean['type'], self::LINK_MARKS, true) ? 'link' : $clean['type'];

            if (!isset($sanitized[$kind])) {
                $sanitized[$kind] = $clean;
            }
        }

        return array_values($sanitized);
    }

    private static function _mark(string $type, array $attrs, ?EditorConfig $config, array $policies): ?array
    {
        if (isset($policies['marks'][$type])) {
            $attrs = $policies['marks'][$type]->sanitizeAttributes($attrs);

            if ($attrs === null) {
                return null;
            }

            return $attrs === [] ? ['type' => $type] : ['type' => $type, 'attrs' => $attrs];
        }

        $feature = self::MARK_FEATURES[$type] ?? null;

        if ($feature === null || !self::_isEnabled($feature, $config)) {
            return null;
        }

        if ($type === 'link') {
            $attrs = self::_linkAttributes($attrs);

            return $attrs === null ? null : ['type' => 'link', 'attrs' => $attrs];
        }

        if ($type === 'craftLink') {
            $attrs = self::_craftLinkAttributes($attrs);

            return $attrs === null ? null : ['type' => 'craftLink', 'attrs' => $attrs];
        }

        return ['type' => $type];
    }

    private static function _linkAttributes(array $attrs): ?array
    {
        $href = $attrs['href'] ?? null;

        if (!is_string($href) || !self::isSafeLink($href)) {
            return null;
        }

        $clean = ['href' => self::trimUrl($href)];

        if (isset($attrs['target']) && in_array($attrs['target'], ['_blank', '_self'], true)) {
            $clean['target'] = $attrs['target'];
        }

        if (isset($attrs['rel']) && is_string($attrs['rel'])) {
            $tokens = array_intersect(preg_split('/\s+/', strtolower(trim($attrs['rel']))) ?: [], ['ugc']);

            // Submitted content can add `ugc` but never drop the defaults.
            $clean['rel'] = implode(' ', array_unique([...self::LINK_REL, ...$tokens]));
        }

        if (isset($attrs['title']) && is_string($attrs['title']) && $attrs['title'] !== '') {
            $clean['title'] = mb_substr($attrs['title'], 0, 255);
        }

        return $clean;
    }

    private static function _craftLinkAttributes(array $attrs): ?array
    {
        $id = filter_var($attrs['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $type = self::_safeIdentifier($attrs['type'] ?? null);

        if ($id === false || $type === null) {
            return null;
        }

        $clean = ['id' => $id, 'type' => $type];
        $label = self::_safeLabel($attrs['label'] ?? null);

        if ($label !== null) {
            $clean['label'] = $label;
        }

        return $clean;
    }

    /**
     * The nearest allowed level, the lower number on a tie. `null` means a paragraph: headings are
     * off, or the level isn't a number at all.
     */
    private static function _headingLevel(mixed $level, ?EditorConfig $config): ?int
    {
        $allowed = $config !== null ? $config->getHeadingLevels() : [1, 2, 3, 4, 5, 6];
        $level = filter_var($level, FILTER_VALIDATE_INT);

        if ($level === false || $allowed === []) {
            return null;
        }

        sort($allowed);
        $nearest = $allowed[0];

        foreach ($allowed as $candidate) {
            if (abs($candidate - $level) < abs($nearest - $level)) {
                $nearest = $candidate;
            }
        }

        return $nearest;
    }

    private static function _isEnabled(Feature $feature, ?EditorConfig $config): bool
    {
        return $config === null || $config->isEnabled($feature);
    }

    private static function _decodedUrl(string $url): string
    {
        $decoded = self::trimUrl($url);

        for ($i = 0; $i < 3; $i++) {
            $next = rawurldecode(html_entity_decode(self::_decodeNumericReferences($decoded), ENT_QUOTES | ENT_HTML5, 'UTF-8'));

            if ($next === $decoded) {
                break;
            }

            $decoded = $next;
        }

        return self::trimUrl($decoded);
    }

    /**
     * Browsers read a numeric character reference even without its semicolon, so
     * `javascript&#58alert(1)` has a colon in an attribute. `html_entity_decode()` needs the semicolon.
     */
    private static function _decodeNumericReferences(string $value): string
    {
        return preg_replace_callback('/&#(?:x([0-9a-f]+)|([0-9]+));?/i', static function(array $match): string {
            $code = $match[1] !== '' ? hexdec($match[1]) : (int)$match[2];

            // Out-of-range and surrogate references become the replacement character, as in a browser.
            return is_int($code) && $code > 0 && $code <= 0x10FFFF && ($code < 0xD800 || $code > 0xDFFF) ? mb_chr($code, 'UTF-8') : "\u{FFFD}";
        }, $value) ?? $value;
    }

    private static function _safeIdentifier(mixed $value): ?string
    {
        if (!is_string($value) || $value === '' || strlen($value) > 255 || !preg_match('/^[A-Za-z0-9_\\\\.-]+$/', $value)) {
            return null;
        }

        return $value;
    }

    private static function _safeLabel(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }

        $value = Normalizer::stripInvisibleChars($value);

        return $value === '' ? null : mb_substr($value, 0, 255);
    }

    private static function _extensionPolicies(?EditorConfig $config): array
    {
        $policies = ['nodes' => [], 'marks' => []];

        foreach ($config?->extensions ?? [] as $extension) {
            if (!$extension instanceof ExtensionPolicyInterface || !is_string($extension::$name ?? null)) {
                continue;
            }

            if ($extension instanceof Node) {
                $policies['nodes'][$extension::$name] = $extension;
            } elseif ($extension instanceof Mark) {
                $policies['marks'][$extension::$name] = $extension;
            }
        }

        return $policies;
    }
}
