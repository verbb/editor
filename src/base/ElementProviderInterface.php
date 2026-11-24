<?php
namespace verbb\editor\base;

use verbb\editor\models\EditorConfig;
use verbb\editor\models\ElementLinkConfig;

interface ElementProviderInterface
{
    // Public Methods
    // =========================================================================

    /**
     * Returns `{id, type, label, url}` results for discovery, each optionally with a `description`
     * and an `imageUrl`. An empty query asks for suggested pages and may return nothing.
     */
    public function search(string $query, ElementLinkConfig $config, EditorConfig $context): array;
    public function resolve(array $reference, ElementLinkConfig $config, EditorConfig $context): ?array;
    /** Resolves references keyed by an opaque key, returning the resolved ones under the same keys. */
    public function resolveAll(array $references, ElementLinkConfig $config, EditorConfig $context): array;
}
