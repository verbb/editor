<?php

declare(strict_types=1);

use verbb\editor\base\AssetResolverInterface;
use verbb\editor\base\MentionProviderInterface;
use verbb\editor\enums\AssetKind;
use verbb\editor\helpers\Tiptap;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\MentionConfig;
use verbb\editor\RichText;
use verbb\editor\services\Documents;

$hostileMention = static fn(): array => [[
    'type' => 'paragraph',
    'content' => [[
        'type' => 'mention',
        'attrs' => ['id' => 4, 'type' => 'craft\\elements\\User', 'label' => '<img src=x onerror=alert(1)>'],
    ]],
]];

$hostileAttachment = static fn(): array => [[
    'type' => 'attachment',
    'attrs' => ['id' => 10, 'url' => '/file.pdf', 'filename' => '<svg onload=alert(2)>"\'.pdf'],
]];

it('escapes hostile labels at the extension render path', function () use ($hostileMention, $hostileAttachment) {
    $mention = Tiptap::contentToHtml($hostileMention());
    $attachment = Tiptap::contentToHtml($hostileAttachment());

    expect($mention)->not->toContain('<img');
    expect($mention)->toContain('@&lt;img src=x onerror=alert(1)&gt;</span>');
    expect($attachment)->not->toContain('<svg');
    expect($attachment)->toContain('&lt;svg onload=alert(2)&gt;&quot;&#039;.pdf</a>');
});

it('escapes a hostile label without a context', function () use ($hostileMention) {
    $html = RichText::from($hostileMention())->toHtml();

    expect($html)->not->toContain('<img');
    expect($html)->toBe('<p>@&lt;img src=x onerror=alert(1)&gt;</p>');
});

it('escapes hostile labels and filenames resolved through a context', function () use ($hostileMention, $hostileAttachment) {
    $config = new EditorConfig([
        'handle' => 'sample.hostile',
        'features' => ['mention' => true, 'attachment' => true],
        'mentions' => new MentionConfig(['enabled' => true]),
        'assets' => new AssetConfig(['enabled' => true]),
        'mentionProvider' => new class implements MentionProviderInterface {
            public function search(string $query, MentionConfig $config, EditorConfig $context): array
            {
                return [];
            }

            public function resolve(array $reference, MentionConfig $config, EditorConfig $context): ?array
            {
                return null;
            }

            public function resolveAll(array $references, MentionConfig $config, EditorConfig $context): array
            {
                return array_map(static fn(array $reference) => ['id' => $reference['id'], 'type' => $reference['type'], 'label' => '<img src=x onerror=alert(1)>'], $references);
            }
        },
        'assetProvider' => new class implements AssetResolverInterface {
            public function resolve(array $reference, AssetConfig $config, EditorConfig $context, AssetKind $kind): ?array
            {
                return null;
            }

            public function resolveAll(array $references, AssetConfig $config, EditorConfig $context): array
            {
                return array_map(static fn(array $reference) => ['id' => $reference['id'], 'filename' => '<svg onload=alert(2)>.pdf', 'url' => '/file.pdf'], $references);
            }
        },
    ]);
    $documents = new Documents();
    $html = $documents->toHtml(RichText::from(array_merge($hostileMention(), $hostileAttachment())), $config, associatedAssetIds: [10]);

    expect($html)->not->toContain('<img', '<svg');
    expect($html)->toContain('@&lt;img src=x onerror=alert(1)&gt;</span>', '&lt;svg onload=alert(2)&gt;.pdf</a>');
});

it('does not double-encode ampersands in structured labels', function () {
    $html = Tiptap::contentToHtml([[
        'type' => 'paragraph',
        'content' => [['type' => 'mention', 'attrs' => ['id' => 4, 'type' => 'user', 'label' => 'Tom & Jerry']]],
    ]]);

    expect($html)->toContain('>@Tom &amp; Jerry</span>');
    expect($html)->not->toContain('&amp;amp;');
});

it('keeps plain text output literal for hostile labels', function () use ($hostileMention, $hostileAttachment) {
    expect(RichText::from($hostileMention())->toPlainText())->toBe('@<img src=x onerror=alert(1)>');
    expect(RichText::from($hostileAttachment())->toPlainText())->toBe('<svg onload=alert(2)>"\'.pdf');
});
