<?php
namespace verbb\editor\services;

use verbb\editor\enums\Feature;
use verbb\editor\models\EditorConfig;

use Craft;
use craft\base\Component;

use yii\web\BadRequestHttpException;

class Mentions extends Component
{
    // Public Methods
    // =========================================================================

    public function search(string $query, EditorConfig $context): array
    {
        if (!$context->isEnabled(Feature::Mention)) {
            throw new BadRequestHttpException(Craft::t('editor', 'Mentions are disabled for this editor context.'));
        }

        return $context->getMentionProvider()->search($query, $context->mentions, $context);
    }

    public function resolve(array $reference, EditorConfig $context): ?array
    {
        if (!$context->isEnabled(Feature::Mention)) {
            return null;
        }

        return $context->getMentionProvider()->resolve($reference, $context->mentions, $context);
    }
}
