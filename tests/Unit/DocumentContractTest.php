<?php

declare(strict_types=1);

use verbb\editor\RichText;

require_once __DIR__ . '/../Support/Fixtures.php';

it('documents fixture contract matches browser canonical storage shape', function (string $fixture) {
    $content = fixtureDocument($fixture);
    $richText = RichText::from($content);

    expect($richText->getSchema())->toBeArray();
    expect(array_is_list($richText->getSchema()))->toBeTrue();

    foreach ($richText->getSchema() as $node) {
        expect($node)->toBeArray()->toHaveKey('type');
    }
})->with([
    'basic-rich-text',
    'nested-lists',
    'links',
    'mixed-formatting',
]);

it('simulates js to php to html to php round trips for fixtures', function (string $fixture) {
    // JS would persist canonical content arrays; PHP normalises the same payload.
    $fromJs = fixtureDocument($fixture);
    $richText = RichText::from($fromJs);
    $html = $richText->toHtml();
    $roundTrip = RichText::fromHtml($html);

    expect($roundTrip->toPlainText())->toBe($richText->toPlainText());
})->with([
    'basic-rich-text',
    'nested-lists',
    'links',
    'mixed-formatting',
]);

it('preserves browser structured reference attributes through PHP HTML import and rendering', function () {
    $html = '<h2><u>Title</u></h2><p><a href="/entry" data-craft-link-id="7" data-craft-link-type="entry" data-craft-link-label="Entry">Entry</a><span data-mention-id="4" data-mention-type="user" data-label="Alice">@Alice</span></p><img src="/image.png" alt="Description" data-editor-asset-id="9"><a href="/file.pdf" data-editor-attachment-id="10" data-filename="Paper" data-mime-type="application/pdf" data-size="1234">Paper</a>';
    $richText = RichText::fromHtml($html);
    $content = $richText->getValue();

    expect($content[0]['type'])->toBe('heading');
    expect($content[0]['content'][0]['marks'][0]['type'])->toBe('underline');
    expect($content[1]['content'][0]['marks'][0]['attrs'])->toMatchArray(['id' => 7, 'type' => 'entry', 'label' => 'Entry', 'href' => '/entry']);
    expect($content[1]['content'][1]['attrs'])->toMatchArray(['id' => 4, 'type' => 'user', 'label' => 'Alice']);
    expect($content[2]['attrs'])->toMatchArray(['id' => 9, 'src' => '/image.png', 'alt' => 'Description']);
    expect($content[3]['attrs'])->toMatchArray(['id' => 10, 'url' => '/file.pdf', 'filename' => 'Paper', 'mimeType' => 'application/pdf', 'size' => 1234]);

    // Rendering without a context has nothing to vouch for these references, so they degrade to text.
    expect($richText->toHtml())->toContain('@Alice', '>Entry')->not->toContain('data-label', 'data-craft-link-id', 'data-mime-type', '/file.pdf');
});
