<?php
namespace verbb\editor\extensions;

use Tiptap\Core\Node;
use Tiptap\Utils\HTML;

class Mention extends Node
{
    // Properties
    // =========================================================================

    public static $name = 'mention';


    // Public Methods
    // =========================================================================

    public function addAttributes()
    {
        return [
            'id' => [
                'default' => null,
                'rendered' => false,
                'parseHTML' => static function($element) {
                    $number = filter_var($element->getAttribute('data-mention-id'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

                    return $number === false ? null : $number;
                },
            ],
            'type' => [
                'default' => null,
                'rendered' => false,
                'parseHTML' => static fn($element) => $element->getAttribute('data-mention-type') ?: null,
            ],
            'label' => [
                'default' => null,
                'rendered' => false,
                'parseHTML' => static fn($element) => $element->getAttribute('data-label') ?: null,
            ],
        ];
    }

    public function parseHTML()
    {
        return [
            [
                'tag' => 'span[data-mention-id]',
            ],
        ];
    }

    public function renderText($node)
    {
        $label = (string)($node->attrs->label ?? 'mention');

        // tiptap-php writes renderText() output into the HTML unescaped, unlike text nodes.
        return htmlspecialchars('@' . $label, ENT_QUOTES, 'UTF-8');
    }

    public function renderHTML($node, $HTMLAttributes = [])
    {
        return [
            'span',
            HTML::mergeAttributes($HTMLAttributes, [
                'data-mention-id' => $node->attrs->id ?? null,
                'data-mention-type' => $node->attrs->type ?? null,
                'data-label' => $node->attrs->label ?? null,
                'class' => 'verbb-editor-mention',
            ]),
            0,
        ];
    }
}
