<?php

declare(strict_types=1);

use verbb\editor\models\EditorConfig;
use verbb\editor\RichText;
use verbb\editor\helpers\Sanitizer;
use Tests\Support\SampleContexts;

require_once __DIR__ . '/../Support/Fixtures.php';

it('strips unsafe link protocols while preserving safe links', function () {
    $content = fixtureDocument('unsafe-links');
    $sanitized = Sanitizer::sanitize($content);

    $json = json_encode($sanitized);

    expect($json)->not->toContain('javascript:');
    expect($json)->toContain('verbb.io');
    expect($sanitized[0]['content'][0]['text'] ?? null)->toBe('Unsafe');
    expect($sanitized[0]['content'][0]['marks'] ?? null)->toBeNull();
    expect($sanitized[0]['content'][2]['marks'][0]['attrs']['href'] ?? null)->toBe('https://verbb.io');
});

it('rejects malformed and unsafe standard and craft links without warnings', function (string $markType, mixed $href) {
    $content = [[
        'type' => 'paragraph',
        'content' => [[
            'type' => 'text',
            'text' => 'Linked text',
            'marks' => [[
                'type' => $markType,
                'attrs' => ['href' => $href],
            ]],
        ]],
    ]];

    set_error_handler(static function (int $severity, string $message, string $file, int $line): never {
        throw new ErrorException($message, 0, $severity, $file, $line);
    });

    try {
        $sanitized = Sanitizer::sanitize($content);
    } finally {
        restore_error_handler();
    }

    expect($sanitized[0]['content'][0]['text'] ?? null)->toBe('Linked text');
    expect($sanitized[0]['content'][0]['marks'] ?? null)->toBeNull();
})->with([
    ['link', ['invalid']],
    ['link', 42],
    ['craftLink', ['invalid']],
    ['craftLink', 42],
    ['craftLink', 'javascript:alert(1)'],
]);

it('preserves safe craft link attributes during sanitization', function () {
    $content = [[
        'type' => 'paragraph',
        'content' => [[
            'type' => 'text',
            'text' => 'Linked text',
            'marks' => [[
                'type' => 'craftLink',
                'attrs' => [
                    'id' => 42,
                    'type' => 'entry',
                    'label' => 'Entry title',
                    'href' => 'https://verbb.io/',
                ],
            ]],
        ]],
    ]];

    $attrs = Sanitizer::sanitize($content)[0]['content'][0]['marks'][0]['attrs'] ?? [];

    expect($attrs)->toBe([
        'id' => 42,
        'type' => 'entry',
        'label' => 'Entry title',
    ]);
});

it('removes unsupported nodes and marks from malformed documents', function () {
    $sanitized = Sanitizer::sanitize(fixtureDocument('malformed'));

    $json = json_encode($sanitized);

    expect($json)->toContain('"type":"heading"');
    expect($json)->not->toContain('"type":"highlight"');
    expect($json)->toContain('Valid');
    expect($json)->toContain('Unknown mark');
});

it('enforces feature policy when an editor context is supplied', function () {
    $config = new EditorConfig([
        'handle' => 'sample.reply',
        'features' => SampleContexts::replyFeatures(),
    ]);

    $content = [
        [
            'type' => 'blockquote',
            'content' => [
                [
                    'type' => 'paragraph',
                    'content' => [
                        ['type' => 'text', 'text' => 'Quoted'],
                    ],
                ],
            ],
        ],
    ];

    expect(Sanitizer::sanitize($content, $config))->not->toBe([]);

    $restricted = new EditorConfig([
        'handle' => 'sample.restricted',
        'features' => [
            'bold' => true,
            'italic' => true,
            'strike' => false,
            'lists' => false,
            'blockquote' => false,
            'code' => false,
            'link' => false,
        ],
    ]);

    $stripped = Sanitizer::sanitize($content, $restricted);

    expect(json_encode($stripped))->not->toContain('blockquote');
    expect($stripped[0]['type'] ?? null)->toBe('paragraph');
});

it('identifies safe and unsafe link targets', function () {

    expect(Sanitizer::isSafeLink('https://verbb.io'))->toBeTrue();
    expect(Sanitizer::isSafeLink('/about'))->toBeTrue();
    expect(Sanitizer::isSafeLink('#section'))->toBeTrue();
    expect(Sanitizer::isSafeLink('mailto:hello@example.com'))->toBeTrue();
    expect(Sanitizer::isSafeLink('javascript:alert(1)'))->toBeFalse();
    expect(Sanitizer::isSafeLink('data:text/html,hello'))->toBeFalse();
    expect(Sanitizer::isSafeLink('java&#x73;cript:alert(1)'))->toBeFalse();
    expect(Sanitizer::isSafeLink('java%73cript:alert(1)'))->toBeFalse();
    expect(Sanitizer::isSafeLink("java\nscript:alert(1)"))->toBeFalse();
});

it('sanitises rendered html output from sanitised content', function () {
    $richText = RichText::from(Sanitizer::sanitize(fixtureDocument('unsafe-links')));

    expect($richText->toHtml())->not->toContain('javascript:');
    expect($richText->toHtml())->toContain('href="https://verbb.io"');
});

it('normalises empty and invalid values to empty documents', function () {

    expect(Sanitizer::sanitize([]))->toBe([]);
    expect(Sanitizer::sanitize([null, ['nope' => true]]))->toBe([]);
});

it('allowlists structured attributes and removes unsafe resource urls', function () {
    $config = SampleContexts::replyConfig();
    $config->assets = new \verbb\editor\models\AssetConfig(['enabled' => true]);
    $config->features['image'] = true;
    $config->features['attachment'] = true;
    $content = [[
        'type' => 'paragraph',
        'content' => [
            [
                'type' => 'mention',
                'attrs' => [
                    'id' => 12,
                    'type' => 'craft\\elements\\User',
                    'label' => '<img onerror=alert(1)>',
                    'onclick' => 'alert(1)',
                ],
            ],
            [
                'type' => 'editorAsset',
                'attrs' => [
                    'id' => 13,
                    'src' => 'java&#x73;cript:alert(1)',
                    'alt' => 'Photo',
                ],
            ],
            [
                'type' => 'attachment',
                'attrs' => [
                    'id' => 14,
                    'url' => 'https://example.test/file.pdf',
                    'filename' => 'file.pdf',
                    'mimeType' => 'application/pdf',
                    'size' => 42,
                    'style' => 'background:url(javascript:alert(1))',
                ],
            ],
        ],
    ]];

    $sanitized = Sanitizer::sanitize($content, $config);
    $mention = $sanitized[0]['content'][0];

    // Blocks nested in a paragraph are lifted out, and references keep identity and authored text only.
    expect($mention['attrs'])->not->toHaveKey('onclick');
    expect($mention['attrs']['label'])->toBe('<img onerror=alert(1)>');
    expect($sanitized[1])->toBe(['type' => 'editorAsset', 'attrs' => ['id' => 13, 'alt' => 'Photo']]);
    expect($sanitized[2])->toBe(['type' => 'attachment', 'attrs' => ['id' => 14]]);
    expect(json_encode($sanitized))->not->toContain('javascript:');
});

it('requires trusted custom extensions to provide an attribute policy', function () {
    $safeExtension = new class extends \Tiptap\Core\Node implements \verbb\editor\base\ExtensionPolicyInterface {
        public static $name = 'callout';

        public function sanitizeAttributes(array $attributes): ?array
        {
            return isset($attributes['tone']) && in_array($attributes['tone'], ['info', 'warning'], true)
                ? ['tone' => $attributes['tone']]
                : null;
        }
    };
    $untrustedExtension = new class extends \Tiptap\Core\Node {
        public static $name = 'unsafeWidget';
    };
    $content = [
        [
            'type' => 'callout',
            'attrs' => ['tone' => 'warning', 'onclick' => 'alert(1)'],
            'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Careful']]]],
        ],
        [
            'type' => 'unsafeWidget',
            'attrs' => ['html' => '<script>alert(1)</script>'],
            'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Still text']]]],
        ],
    ];

    $sanitized = Sanitizer::sanitize($content, new EditorConfig(['extensions' => [$safeExtension, $untrustedExtension]]));

    expect($sanitized[0]['type'])->toBe('callout');
    expect($sanitized[0]['attrs'])->toBe(['tone' => 'warning']);
    expect(json_encode($sanitized))->not->toContain('onclick');
    expect(json_encode($sanitized))->not->toContain('unsafeWidget');
    expect(json_encode($sanitized))->toContain('Still text');
});
