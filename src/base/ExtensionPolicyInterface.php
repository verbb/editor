<?php
namespace verbb\editor\base;

/**
 * Trusted server extensions implement this contract to validate submitted attributes.
 */
interface ExtensionPolicyInterface
{
    // Public Methods
    // =========================================================================

    public function sanitizeAttributes(array $attributes): ?array;
}
