<?php

declare(strict_types=1);

namespace Tests\Support;

use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\ElementLinkConfig;
use verbb\editor\models\MentionConfig;
use verbb\editor\services\EditorConfigs;

use craft\elements\Entry;

/**
 * Neutral contexts for Editor's own tests. Consumers register their own in their bootstrap.
 */
final class SampleContexts
{
    public static function register(EditorConfigs $configs): void
    {
        $configs->registerConfig(self::replyConfig());
        $configs->registerConfig(self::editConfig());
    }

    public static function clear(EditorConfigs $configs): void
    {
        (function(): void {
            $this->_configs = [];
        })->call($configs);
    }

    public static function replyConfig(): EditorConfig
    {
        return new EditorConfig([
            'handle' => 'sample.reply',
            'placeholder' => 'Write a reply…',
            'features' => self::replyFeatures(),
            'mentions' => new MentionConfig([
                'enabled' => true,
                'minQueryLength' => 2,
                'limit' => 10,
            ]),
            'elementLinks' => new ElementLinkConfig([
                'enabled' => false,
                'elementTypes' => [Entry::class],
                'limit' => 10,
            ]),
            'assets' => new AssetConfig([
                'enabled' => false,
            ]),
        ]);
    }

    public static function editConfig(): EditorConfig
    {
        $config = self::replyConfig();
        $config->handle = 'sample.edit';
        $config->placeholder = 'Edit your comment…';

        return $config;
    }

    public static function replyFeatures(): array
    {
        return [
            'bold' => true,
            'italic' => true,
            'strike' => true,
            'lists' => true,
            'blockquote' => true,
            'code' => true,
            'link' => true,
            'mention' => true,
            'image' => false,
            'attachment' => false,
            'craftLink' => false,
        ];
    }
}
