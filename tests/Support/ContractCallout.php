<?php

declare(strict_types=1);

namespace Tests\Support;

use Tiptap\Core\Node;
use verbb\editor\base\ExtensionPolicyInterface;

class ContractCallout extends Node implements ExtensionPolicyInterface
{
    public static $name = 'callout';

    public function sanitizeAttributes(array $attributes): ?array
    {
        return in_array($attributes['tone'] ?? null, ['info', 'warning'], true) ? ['tone' => $attributes['tone']] : null;
    }

    public function addAttributes()
    {
        return ['tone' => ['default' => 'info', 'parseHTML' => static fn($element) => $element->getAttribute('data-tone')]];
    }

    public function parseHTML()
    {
        return [['tag' => 'section[data-tone]']];
    }

    public function renderHTML($node, $HTMLAttributes = [])
    {
        return ['section', ['data-tone' => $node->attrs->tone ?? 'info'], 0];
    }
}
