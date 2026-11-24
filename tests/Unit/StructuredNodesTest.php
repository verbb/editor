<?php

declare(strict_types=1);

use verbb\editor\RichText;
use verbb\editor\helpers\Sanitizer;
use Tests\Support\SampleContexts;

require_once __DIR__ . '/../Support/Fixtures.php';

it('renders mention nodes to html and plain text', function () {
    $richText = RichText::from(fixtureDocument('mention'));

    expect($richText->toPlainText())->toContain('@Ash');
    // Without a context the mention falls back to its label as plain text.
    expect($richText->toHtml())->toContain('@Ash')->not->toContain('data-mention-id');
});

it('preserves mention nodes when mention policy is enabled', function () {
    $config = SampleContexts::replyConfig();
    $sanitized = Sanitizer::sanitize(fixtureDocument('mention'), $config);

    expect($sanitized[0]['content'][1]['type'] ?? null)->toBe('mention');
});

it('strips mention nodes when mention policy is disabled', function () {
    $config = SampleContexts::replyConfig();
    $config->mentions = null;
    $sanitized = Sanitizer::sanitize(fixtureDocument('mention'), $config);

    expect(json_encode($sanitized))->not->toContain('"type":"mention"');
    expect($sanitized[0]['content'][0]['text'] ?? '')->toContain('Hello');
});
