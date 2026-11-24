<?php
namespace verbb\editor\helpers;

use verbb\editor\extensions\Attachment;
use verbb\editor\extensions\CraftLink;
use verbb\editor\extensions\EditorAsset;
use verbb\editor\extensions\Mention;

use Tiptap\Editor;
use Tiptap\Extensions\StarterKit;
use Tiptap\Marks\Link;
use Tiptap\Marks\Underline;

use TypeError;

class Tiptap
{
    // Constants
    // =========================================================================

    private const MAX_MEMOIZED_EDITORS = 16;

    private const ATOM_NODES = [
        'mention',
        'editorAsset',
        'attachment',
    ];


    // Properties
    // =========================================================================

    private static array $_editors = [];


    // Static Methods
    // =========================================================================

    /**
     * Building the schema is the expensive part of a render, and rendering holds no per-document
     * state beyond setContent(), so one editor per extension set serves a whole request. The cap
     * bounds consumers that build a context, and so new extension objects, per record.
     */
    public static function create(array $extensions = []): Editor
    {
        // Prefixed so a single ID stays a string key: array_shift() below would renumber integer keys.
        $key = 'extensions:' . implode(',', array_map('spl_object_id', $extensions));

        if (!isset(self::$_editors[$key])) {
            if (count(self::$_editors) >= self::MAX_MEMOIZED_EDITORS) {
                array_shift(self::$_editors);
            }

            self::$_editors[$key] = new Editor([
                'extensions' => [
                    new StarterKit([
                        'heading' => [
                            'levels' => [1, 2, 3, 4, 5, 6],
                        ],
                        'codeBlock' => false,
                        'horizontalRule' => false,
                    ]),
                    new Underline(),
                    new Link([
                        'HTMLAttributes' => [
                            'rel' => 'noopener noreferrer nofollow',
                            'target' => '_blank',
                        ],
                    ]),
                    new CraftLink(),
                    new Mention(),
                    new EditorAsset(),
                    new Attachment(),
                    ...$extensions,
                ],
            ]);
        }

        return self::$_editors[$key];
    }

    public static function htmlToContent(string $html, array $extensions = []): array
    {
        try {
            $document = self::create($extensions)->setContent($html)->getDocument();
        } catch (TypeError $e) {
            // tiptap-php expects a `<body>`, which HTML holding only head content such as a comment,
            // `<script>` or `<meta>` never produces. None of that is document content. Any other
            // failure, such as in an extension's parser, must still surface.
            if (!str_contains($e->getMessage(), 'DOMParser::getDocumentBody()')) {
                throw $e;
            }

            return [];
        }

        return is_array($document) ? self::_stripAtomContent($document['content'] ?? []) : [];
    }

    public static function contentToHtml(array $content, array $extensions = [], bool $nl2br = false): string
    {
        if ($content === []) {
            return '';
        }

        $html = self::create($extensions)->setContent([
            'type' => 'doc',
            'content' => $content,
        ])->getHTML();

        if ($nl2br) {
            $html = str_replace(['<p>', '</p>'], ['', '<br>'], $html);
            $html = preg_replace('/(<br>)+$/', '', $html) ?? $html;
        }

        return Normalizer::stripInvisibleChars($html);
    }


    // Private Methods
    // =========================================================================

    private static function _stripAtomContent(array $nodes): array
    {
        // tiptap-php parses an atom's rendered label into a text child, which the browser's schema rejects.
        foreach ($nodes as &$node) {
            if (in_array($node['type'] ?? null, self::ATOM_NODES, true)) {
                unset($node['content']);
            } elseif (isset($node['content']) && is_array($node['content'])) {
                $node['content'] = self::_stripAtomContent($node['content']);
            }
        }

        return $nodes;
    }
}
