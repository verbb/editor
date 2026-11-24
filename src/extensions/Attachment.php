<?php
namespace verbb\editor\extensions;

use Tiptap\Core\Node;
use Tiptap\Utils\HTML;

class Attachment extends Node
{
    // Properties
    // =========================================================================

    public static $name = 'attachment';


    // Public Methods
    // =========================================================================

    public function addAttributes()
    {
        return [
            'id' => [
                'default' => null,
                'rendered' => false,
                'parseHTML' => static function($element) {
                    $number = filter_var($element->getAttribute('data-editor-attachment-id'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

                    return $number === false ? null : $number;
                },
            ],
            'filename' => [
                'default' => null,
                'rendered' => false,
                'parseHTML' => static fn($element) => $element->getAttribute('data-filename') ?: null,
            ],
            'url' => [
                'default' => null,
                'rendered' => false,
                'parseHTML' => static fn($element) => $element->getAttribute('href') ?: null,
            ],
            'mimeType' => [
                'default' => null,
                'rendered' => false,
                'parseHTML' => static fn($element) => $element->getAttribute('data-mime-type') ?: null,
            ],
            'size' => [
                'default' => null,
                'rendered' => false,
                'parseHTML' => static function($element) {
                    $number = filter_var($element->getAttribute('data-size'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);

                    return $number === false ? null : $number;
                },
            ],
        ];
    }

    public function parseHTML()
    {
        return [
            [
                'tag' => 'a[data-editor-attachment-id]',
            ],
        ];
    }

    public function renderText($node)
    {
        // tiptap-php writes renderText() output into the HTML unescaped, unlike text nodes.
        return htmlspecialchars((string)($node->attrs->filename ?? 'Attachment'), ENT_QUOTES, 'UTF-8');
    }

    public function renderHTML($node, $HTMLAttributes = [])
    {
        return [
            'a',
            HTML::mergeAttributes($HTMLAttributes, [
                'href' => $node->attrs->url ?? '#',
                'data-editor-attachment-id' => $node->attrs->id ?? null,
                'data-filename' => $node->attrs->filename ?? null,
                'data-mime-type' => $node->attrs->mimeType ?? null,
                'data-size' => $node->attrs->size ?? null,
                'class' => 'verbb-editor-attachment',
            ]),
            0,
        ];
    }
}
