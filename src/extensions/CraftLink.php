<?php
namespace verbb\editor\extensions;

use Tiptap\Marks\Link;
use Tiptap\Utils\HTML;

/**
 * Structured Craft element link mark.
 */
class CraftLink extends Link
{
    // Properties
    // =========================================================================

    public static $name = 'craftLink';


    // Public Methods
    // =========================================================================

    public function addOptions()
    {
        $options = parent::addOptions();

        // Craft links opt into attributes explicitly rather than inheriting Link defaults.
        $options['HTMLAttributes'] = [];

        return $options;
    }

    public function addAttributes()
    {
        return [
            'id' => [
                'default' => null,
                'rendered' => false,
                'parseHTML' => static function($element) {
                    $number = filter_var($element->getAttribute('data-craft-link-id'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

                    return $number === false ? null : $number;
                },
            ],
            'type' => [
                'default' => null,
                'rendered' => false,
                'parseHTML' => static fn($element) => $element->getAttribute('data-craft-link-type') ?: null,
            ],
            'label' => [
                'default' => null,
                'rendered' => false,
                'parseHTML' => static fn($element) => $element->getAttribute('data-craft-link-label') ?: null,
            ],
            'href' => [
                'default' => null,
                'rendered' => false,
            ],
        ];
    }

    public function parseHTML()
    {
        return [
            [
                'tag' => 'a[data-craft-link-id]',
                'priority' => 60,
            ],
        ];
    }

    public function renderHTML($mark, $HTMLAttributes = [])
    {
        $href = $mark->attrs->href ?? '';

        if (!is_string($href) || !$this->isAllowedUri($href)) {
            $href = '';
        }

        return [
            'a',
            HTML::mergeAttributes($this->options['HTMLAttributes'] ?? [], $HTMLAttributes, [
                'href' => $href,
                'data-craft-link-id' => $mark->attrs->id ?? null,
                'data-craft-link-type' => $mark->attrs->type ?? null,
                'data-craft-link-label' => $mark->attrs->label ?? null,
            ]),
            0,
        ];
    }
}
