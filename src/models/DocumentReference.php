<?php
namespace verbb\editor\models;

use craft\base\Model;

/**
 * A semantic reference extracted from a normalised Editor document node.
 */
class DocumentReference extends Model
{
    // Properties
    // =========================================================================

    public string $nodeType = '';
    public array $attrs = [];
    public string $occurrenceKey = '';


    // Public Methods
    // =========================================================================

    public function referenceId(): ?string
    {
        $id = $this->attrs['id'] ?? null;

        if ($id === null || $id === '') {
            return null;
        }

        return (string)$id;
    }

    public function referenceType(): ?string
    {
        $type = $this->attrs['type'] ?? null;

        return is_string($type) && $type !== '' ? $type : null;
    }
}
