<?php
namespace verbb\editor\base;

use verbb\editor\models\EditorConfig;
use verbb\editor\models\MentionConfig;

interface MentionProviderInterface
{
    // Public Methods
    // =========================================================================

    /**
     * Returns `{id, type, label}` results for discovery, each optionally with a `description` and an
     * `imageUrl`, which the editor shows as a role line and an avatar. An empty query asks for
     * suggestions, such as the people in a conversation, and may return nothing.
     */
    public function search(string $query, MentionConfig $config, EditorConfig $context): array;
    public function resolve(array $reference, MentionConfig $config, EditorConfig $context): ?array;
    /** Resolves references keyed by an opaque key, returning the resolved ones under the same keys. */
    public function resolveAll(array $references, MentionConfig $config, EditorConfig $context): array;
}
