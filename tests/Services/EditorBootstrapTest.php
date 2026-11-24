<?php

declare(strict_types=1);

use verbb\editor\Editor;
use verbb\editor\base\MentionProviderInterface;
use verbb\editor\errors\EditorConfigNotFoundException;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\MentionConfig;
use Tests\Support\SampleContexts;

it('boots Editor with an empty context registry by default', function () {
    $editor = Editor::getInstance();

    expect($editor)->not->toBeNull();
    expect($editor->getEditorConfigs()->getAllConfigs())->toBe([]);
});

it('requires consuming plugins to register trusted contexts explicitly', function () {
    $configs = Editor::getInstance()->getEditorConfigs();

    SampleContexts::register($configs);

    expect(array_keys($configs->getAllConfigs()))->toBe(['sample.reply', 'sample.edit']);
    expect($configs->requireConfigByHandle('sample.reply')->handle)->toBe('sample.reply');
    expect($configs->requireConfigByHandle('sample.edit')->placeholder)->toBe('Edit your comment…');
});

it('throws when resolving an unknown context handle', function () {
    $configs = Editor::getInstance()->getEditorConfigs();

    $configs->requireConfigByHandle('sample.reply');
})->throws(EditorConfigNotFoundException::class);

it('isolates context registrations by handle', function () {
    $configs = Editor::getInstance()->getEditorConfigs();

    SampleContexts::register($configs);

    $reply = $configs->requireConfigByHandle('sample.reply');
    $edit = $configs->requireConfigByHandle('sample.edit');

    expect($reply->handle)->toBe('sample.reply');
    expect($edit->handle)->toBe('sample.edit');
    expect($reply->placeholder)->not->toBe($edit->placeholder);
    expect($configs->getConfigByHandle('sample.moderate'))->toBeNull();
});

it('isolates mention providers by registered context', function () {
    $providers = [
        new class('consumer-a') implements MentionProviderInterface {
            public function __construct(private string $label) {}
            public function search(string $query, MentionConfig $config, EditorConfig $context): array
            {
                return [['id' => 1, 'type' => 'user', 'label' => $this->label]];
            }
            public function resolve(array $reference, MentionConfig $config, EditorConfig $context): ?array
            {
                return $this->search('', $config, $context)[0];
            }
            public function resolveAll(array $references, MentionConfig $config, EditorConfig $context): array
            {
                return array_map(fn(array $reference) => $this->resolve($reference, $config, $context), $references);
            }
        },
        new class('consumer-b') implements MentionProviderInterface {
            public function __construct(private string $label) {}
            public function search(string $query, MentionConfig $config, EditorConfig $context): array
            {
                return [['id' => 2, 'type' => 'user', 'label' => $this->label]];
            }
            public function resolve(array $reference, MentionConfig $config, EditorConfig $context): ?array
            {
                return $this->search('', $config, $context)[0];
            }
            public function resolveAll(array $references, MentionConfig $config, EditorConfig $context): array
            {
                return array_map(fn(array $reference) => $this->resolve($reference, $config, $context), $references);
            }
        },
    ];
    $editor = Editor::getInstance();
    $configs = $editor->getEditorConfigs();
    $contexts = [];

    foreach (['consumer.a', 'consumer.b'] as $index => $handle) {
        $contexts[$handle] = new EditorConfig([
            'handle' => $handle,
            'features' => ['mention' => true],
            'mentions' => new MentionConfig(['enabled' => true]),
            'mentionProvider' => $providers[$index],
        ]);
        $configs->registerConfig($contexts[$handle]);
    }

    expect($editor->getMentions()->search('test', $contexts['consumer.a'])[0]['label'])->toBe('consumer-a');
    expect($editor->getMentions()->search('test', $contexts['consumer.b'])[0]['label'])->toBe('consumer-b');
});

it('escapes a hostile label resolved through a context provider', function () {
    $provider = new class implements MentionProviderInterface {
        public function search(string $query, MentionConfig $config, EditorConfig $context): array
        {
            return [];
        }

        public function resolve(array $reference, MentionConfig $config, EditorConfig $context): ?array
        {
            return ['id' => 42, 'type' => 'user', 'label' => '<img src=x onerror=alert(1)>'];
        }

        public function resolveAll(array $references, MentionConfig $config, EditorConfig $context): array
        {
            return array_map(fn(array $reference) => $this->resolve($reference, $config, $context), $references);
        }
    };
    $config = new EditorConfig([
        'handle' => 'references.hostile',
        'features' => ['mention' => true],
        'mentions' => new MentionConfig(['enabled' => true]),
        'mentionProvider' => $provider,
    ]);
    $richText = \verbb\editor\RichText::from([[
        'type' => 'paragraph',
        'content' => [['type' => 'mention', 'attrs' => ['id' => 42, 'type' => 'user', 'label' => 'Stored']]],
    ]]);

    $html = Editor::getInstance()->getDocuments()->toHtml($richText, config: $config);

    expect($html)->not->toContain('<img');
    expect($html)->toContain('@&lt;img src=x onerror=alert(1)&gt;</span>');
});

it('resolves repeated structured references once per render', function () {
    $provider = new class implements MentionProviderInterface {
        public int $resolveCalls = 0;

        public function search(string $query, MentionConfig $config, EditorConfig $context): array
        {
            return [];
        }

        public function resolve(array $reference, MentionConfig $config, EditorConfig $context): ?array
        {
            return ['id' => 42, 'type' => 'user', 'label' => 'Resolved'];
        }

        public function resolveAll(array $references, MentionConfig $config, EditorConfig $context): array
        {
            $this->resolveCalls++;

            return array_map(fn(array $reference) => $this->resolve($reference, $config, $context), $references);
        }
    };
    $config = new EditorConfig([
        'handle' => 'references.cached',
        'features' => ['mention' => true],
        'mentions' => new MentionConfig(['enabled' => true]),
        'mentionProvider' => $provider,
    ]);
    $richText = \verbb\editor\RichText::from([[
        'type' => 'paragraph',
        'content' => [
            ['type' => 'mention', 'attrs' => ['id' => 42, 'type' => 'user', 'label' => 'Old label']],
            ['type' => 'text', 'text' => ' and '],
            ['type' => 'mention', 'attrs' => ['id' => 42, 'type' => 'user', 'label' => 'Old label']],
        ],
    ]]);

    $html = Editor::getInstance()->getDocuments()->toHtml($richText, config: $config);

    expect($provider->resolveCalls)->toBe(1);
    expect(substr_count(strip_tags($html), 'Resolved'))->toBe(2);
    expect($html)->not->toContain('Old label');
});
