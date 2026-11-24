<?php

declare(strict_types=1);

use verbb\editor\models\EditorConfig;
use verbb\editor\RichText;
use verbb\editor\services\Documents;
use Tests\Support\SampleContexts;

require_once __DIR__ . '/../Support/Fixtures.php';

it('sanitises documents through the documents service using a trusted context', function () {
    $documents = new Documents();
    $documents->init();

    $config = new EditorConfig([
        'handle' => 'sample.reply',
        'features' => SampleContexts::replyFeatures(),
    ]);

    $richText = $documents->normalize(fixtureDocument('unsafe-links'), $config);

    expect($richText->toHtml())->not->toContain('javascript:');
    expect($richText->toPlainText())->toContain('Unsafe');
    expect($richText->toPlainText())->toContain('Safe');
});

it('preserves canonical fixture content when no policy restrictions apply', function () {
    $documents = new Documents();
    $documents->init();

    $original = RichText::from(fixtureDocument('basic-rich-text'));
    $sanitized = $documents->normalize(fixtureDocument('basic-rich-text'));

    expect($sanitized->toPlainText())->toBe($original->toPlainText());
    expect($sanitized->toHtml())->toBe($original->toHtml());
});

it('keeps unsafe text escaped through the documents service', function () {
    $documents = new Documents();
    $documents->init();
    $richText = RichText::from([[
        'type' => 'paragraph',
        'content' => [['type' => 'text', 'text' => '<svg onload=alert(1)>']],
    ]]);

    expect($documents->toHtml($richText))->toContain('&lt;svg onload=alert(1)&gt;');
    expect($documents->toHtml($richText))->not->toContain('<svg');
});
