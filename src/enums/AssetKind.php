<?php
namespace verbb\editor\enums;

enum AssetKind: string
{
    case InlineImage = 'inlineImage';
    case Attachment = 'attachment';

    // Public Methods
    // =========================================================================

    public function feature(): Feature
    {
        return $this === self::InlineImage ? Feature::Image : Feature::Attachment;
    }
}
