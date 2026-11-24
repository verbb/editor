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
 * Stub resolvers for the cross-layer contract test, which runs PHP without a Craft application.
 */
class ContractMentions implements MentionProviderInterface
{
    public function search(string $query, MentionConfig $config, EditorConfig $context): array
    {
        return [];
    }

    public function resolve(array $reference, MentionConfig $config, EditorConfig $context): ?array
    {
        return $reference;
    }

    public function resolveAll(array $references, MentionConfig $config, EditorConfig $context): array
    {
        return $references;
    }
}

class ContractElements implements ElementProviderInterface
{
    public function search(string $query, ElementLinkConfig $config, EditorConfig $context): array
    {
        return [];
    }

    public function resolve(array $reference, ElementLinkConfig $config, EditorConfig $context): ?array
    {
        return $reference + ['url' => '/entry'];
    }

    public function resolveAll(array $references, ElementLinkConfig $config, EditorConfig $context): array
    {
        return array_map(static fn(array $reference) => $reference + ['url' => '/entry'], $references);
    }
}

class ContractAssets implements AssetResolverInterface
{
    public function resolve(array $reference, AssetConfig $config, EditorConfig $context, AssetKind $kind): ?array
    {
        return null;
    }

    public function resolveAll(array $references, AssetConfig $config, EditorConfig $context): array
    {
        return array_map(static fn(array $reference) => $reference['kind'] === 'inlineImage'
            ? ['id' => $reference['id'], 'url' => '/image.png', 'filename' => 'image.png']
            : ['id' => $reference['id'], 'url' => '/file.pdf', 'filename' => 'Paper <b>1</b>.pdf', 'mimeType' => 'application/pdf', 'size' => 1234], $references);
    }
}
