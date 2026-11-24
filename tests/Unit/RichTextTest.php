<?php

declare(strict_types=1);

use verbb\editor\RichText;
use verbb\editor\helpers\Normalizer;

require_once __DIR__ . '/../Support/Fixtures.php';

it('normalises fixture documents to canonical content arrays', function (string $fixture) {
    $content = fixtureDocument($fixture);
    $richText = RichText::from($content);

    expect($richText->isEmpty())->toBeFalse();
    expect($richText->getSchema())->toBeArray();
    expect($richText->jsonSerialize())->toBe($richText->getSchema());
})->with([
    'basic-rich-text',
    'nested-lists',
    'links',
    'mixed-formatting',
]);

it('renders fixture documents to html and plain text', function (string $fixture, array $plainExpectations) {
    $richText = RichText::from(fixtureDocument($fixture));
    $html = $richText->toHtml();
    $plain = $richText->toPlainText();

    expect($html)->not->toBe('');
    expect($plain)->not->toBe('');

    foreach ($plainExpectations as $fragment) {
        expect($plain)->toContain($fragment);
    }
})->with([
    ['basic-rich-text', ['Hello', 'world']],
    ['nested-lists', ['One', 'Nested', 'Two']],
    ['links', ['Visit', 'Verbb', 'plugins']],
    ['mixed-formatting', ['Bold italic', 'quoted', 'inline()']],
]);

it('drops malformed and unsafe link targets when rendering', function (string $markType, mixed $href) {
    $richText = RichText::from([[
        'type' => 'paragraph',
        'content' => [[
            'type' => 'text',
            'text' => 'Linked text',
            'marks' => [[
                'type' => $markType,
                'attrs' => ['href' => $href],
            ]],
        ]],
    ]]);

    $html = $richText->toHtml();

    expect($html)->toContain('Linked text');
    expect($html)->not->toContain('invalid');
    expect($html)->not->toContain('javascript:');
    expect($html)->not->toContain('data:');
})->with([
    ['link', ['invalid']],
    ['link', 42],
    ['link', 'javascript:alert(1)'],
    ['craftLink', ['invalid']],
    ['craftLink', 42],
    ['craftLink', 'javascript:alert(1)'],
    ['craftLink', 'data:text/html,invalid'],
]);

it('preserves valid standard and craft link targets', function (string $markType, string $href) {
    $richText = RichText::from([[
        'type' => 'paragraph',
        'content' => [[
            'type' => 'text',
            'text' => 'Linked text',
            'marks' => [[
                'type' => $markType,
                'attrs' => ['href' => $href],
            ]],
        ]],
    ]]);

    $html = $richText->toHtml();

    expect($html)->toContain('href="' . $href . '"');
})->with([
    ['link', 'https://verbb.io/'],
    ['link', '#entry:42'],
]);

it('renders craft links as their text without a context', function () {
    $html = RichText::from([[
        'type' => 'paragraph',
        'content' => [[
            'type' => 'text',
            'text' => 'Linked text',
            'marks' => [['type' => 'craftLink', 'attrs' => ['id' => 7, 'type' => 'entry', 'href' => 'https://verbb.io/']]],
        ]],
    ]])->toHtml();

    expect($html)->toBe('<p>Linked text</p>');
});

it('accepts full doc wrappers and json strings', function () {
    $content = fixtureDocument('basic-rich-text');
    $doc = ['type' => 'doc', 'content' => $content];
    $json = json_encode($doc, JSON_THROW_ON_ERROR);

    expect(RichText::from($doc)->getSchema())->toBe(RichText::from($content)->getSchema());
    expect(RichText::from($json)->getSchema())->toBe(RichText::from($content)->getSchema());
});

it('imports html into canonical content', function () {
    $richText = RichText::fromHtml('<p>Imported <strong>HTML</strong></p>');

    expect($richText->isEmpty())->toBeFalse();
    expect($richText->toHtml())->toContain('<strong>HTML</strong>');
    expect($richText->toPlainText())->toBe('Imported HTML');
});

it('round-trips fixture content through html import', function (string $fixture) {
    $original = RichText::from(fixtureDocument($fixture));
    $roundTrip = RichText::fromHtml($original->toHtml());

    expect($roundTrip->toPlainText())->toBe($original->toPlainText());
})->with([
    'basic-rich-text',
    'nested-lists',
    'links',
    'mixed-formatting',
]);

it('treats empty values as empty documents', function () {
    expect(RichText::from(null)->isEmpty())->toBeTrue();
    expect(RichText::from('')->isEmpty())->toBeTrue();
    expect(RichText::from([])->isEmpty())->toBeTrue();
});

it('keeps literal user markup escaped during direct rendering', function () {
    $richText = RichText::from([[
        'type' => 'paragraph',
        'content' => [[
            'type' => 'text',
            'text' => '<img src=x onerror=alert(1)>',
        ]],
    ]]);

    expect($richText->toHtml())->toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect($richText->toHtml())->not->toContain('<img');
});

it('only converts legacy names in structural node and mark identifiers', function () {
    $content = [[
        'type' => 'bullet_list',
        'attrs' => [
            'label' => 'bullet_list',
            'url' => 'https://example.test/bullet_list',
            'type' => 'bullet_list',
        ],
        'content' => [[
            'type' => 'list_item',
            'content' => [[
                'type' => 'paragraph',
                'content' => [[
                    'type' => 'text',
                    'text' => 'bullet_list',
                    'marks' => [['type' => 'code_block']],
                ]],
            ]],
        ]],
    ]];

    $normalized = Normalizer::normalize($content);

    expect($normalized[0]['type'])->toBe('bulletList');
    expect($normalized[0]['content'][0]['type'])->toBe('listItem');
    expect($normalized[0]['content'][0]['content'][0]['content'][0]['marks'][0]['type'])->toBe('codeBlock');
    expect($normalized[0]['attrs'])->toBe([
        'label' => 'bullet_list',
        'url' => 'https://example.test/bullet_list',
        'type' => 'bullet_list',
    ]);
    expect($normalized[0]['content'][0]['content'][0]['content'][0]['text'])->toBe('bullet_list');
});

it('preserves unicode joiners in meaningful text', function () {
    $text = "Family 👨‍👩‍👧‍👦 and فارسی‌نویسی";

    expect(RichText::from($text)->toPlainText())->toBe($text);
});

it('counts text length the way the browser limit does', function () {
    $paragraph = static fn(string $text): array => ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $text]]];

    // Blank lines between blocks count, as in the plain text.
    expect(RichText::from([$paragraph('One'), $paragraph('Two')])->getTextLength())->toBe(8);

    // Mentions count as @label, and media alt text and filenames don't count.
    expect(RichText::from([
        ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Hi '], ['type' => 'mention', 'attrs' => ['id' => 1, 'type' => 'user', 'label' => 'Al']]]],
        ['type' => 'editorAsset', 'attrs' => ['id' => 2, 'alt' => 'Photo']],
        ['type' => 'attachment', 'attrs' => ['id' => 3, 'filename' => 'Paper.pdf']],
    ])->getTextLength())->toBe(6);

    // Unicode characters, matching the browser's count rather than bytes.
    expect(RichText::from([$paragraph('Party 🎉')])->getTextLength())->toBe(7);
    expect(RichText::from(null)->getTextLength())->toBe(0);
});
