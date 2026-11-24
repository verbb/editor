<?php
namespace verbb\editor\services;

use verbb\editor\enums\Feature;
use verbb\editor\models\EditorConfig;

use Craft;
use craft\base\Component;

use yii\web\BadRequestHttpException;

class Elements extends Component
{
    // Public Methods
    // =========================================================================

    public function search(string $query, EditorConfig $context): array
    {
        if (!$context->isEnabled(Feature::CraftLink)) {
            throw new BadRequestHttpException(Craft::t('editor', 'Craft element links are disabled for this editor context.'));
        }

        return $context->getElementProvider()->search($query, $context->elementLinks, $context);
    }

    public function resolve(array $reference, EditorConfig $context): ?array
    {
        if (!$context->isEnabled(Feature::CraftLink)) {
            return null;
        }

        return $context->getElementProvider()->resolve($reference, $context->elementLinks, $context);
    }
}
