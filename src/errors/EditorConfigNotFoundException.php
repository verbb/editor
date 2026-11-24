<?php
namespace verbb\editor\errors;

use InvalidArgumentException;

class EditorConfigNotFoundException extends InvalidArgumentException
{
    // Public Methods
    // =========================================================================

    public function __construct(string $handle)
    {
        parent::__construct("Editor context not registered: {$handle}");
    }
}
