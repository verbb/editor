<?php
namespace verbb\editor\base;

use verbb\editor\enums\AssetKind;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;

/**
 * Turns stored asset references into `{id, filename, url, kind, mimeType, size}`. A render-only
 * provider implements this alone. Editor only asks about IDs the consumer passed as associated
 * with the document being rendered.
 */
interface AssetResolverInterface
{
    // Public Methods
    // =========================================================================

    public function resolve(array $reference, AssetConfig $config, EditorConfig $context, AssetKind $kind): ?array;
    /** Each reference carries `id` and `kind`; returns the resolved ones under the same keys. */
    public function resolveAll(array $references, AssetConfig $config, EditorConfig $context): array;
}
