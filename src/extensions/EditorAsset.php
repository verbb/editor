<?php
namespace verbb\editor\extensions;

use Tiptap\Core\Node;
use Tiptap\Utils\HTML;

class EditorAsset extends Node
{
    // Properties
    // =========================================================================

    public static $name = 'editorAsset';


    // Public Methods
    // =========================================================================

    public function addAttributes()
    {
        return [
            'id' => [
                'default' => null,
                'rendered' => false,
                'parseHTML' => static function($element) {
                    $number = filter_var($element->getAttribute('data-editor-asset-id'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

                    return $number === false ? null : $number;
                },
            ],
            'src' => [
                'default' => null,
                'rendered' => false,
            ],
            'alt' => [
                'default' => null,
                'rendered' => false,
            ],
            'title' => [
                'default' => null,
                'rendered' => false,
            ],
        ];
    }

    public function parseHTML()
    {
        return [
            [
                'tag' => 'img[data-editor-asset-id]',
            ],
        ];
    }

    public function renderHTML($node, $HTMLAttributes = [])
    {
        return [
            'img',
            HTML::mergeAttributes($HTMLAttributes, [
                'src' => $node->attrs->src ?? null,
                'alt' => $node->attrs->alt ?? '',
                'title' => $node->attrs->title ?? null,
                'data-editor-asset-id' => $node->attrs->id ?? null,
            ]),
        ];
    }
}
