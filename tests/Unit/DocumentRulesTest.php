<?php

declare(strict_types=1);

use verbb\editor\helpers\Normalizer;
use verbb\editor\helpers\Sanitizer;
use verbb\editor\helpers\Tiptap;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\MentionConfig;
use verbb\editor\RichText;
use verbb\editor\services\Documents;
use Tests\Support\ContractCallout;

function paragraph(string $text): array
{
    return ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $text]]];
}

function headingNode(mixed $level, string $text = 'Title'): array
{
    return ['type' => 'heading', 'attrs' => ['level' => $level], 'content' => [['type' => 'text', 'text' => $text]]];
}

it('only treats document-shaped strings as documents', function (string $value, bool $isDocument) {
    expect(Normalizer::decodeDocument($value) !== null)->toBe($isDocument);
})->with([
    ['{"type":"doc","content":[]}', true],
    ['[{"type":"paragraph"}]', true],
    ['[{"type":"paragraph"},{"type":"heading"}]', true],
    ['123', false],
    ['true', false],
    ['false', false],
    ['null', false],
    ['3.14', false],
    ['[1,2]', false],
    ['[]', false],
    ['{"a":1}', false],
    ['{"type":"paragraph"}', false],
    ['[{"type":1}]', false],
    ['[{"type":"paragraph"},2]', false],
    ['not json', false],
]);

it('keeps strings that are not documents as literal text', function (string $value) {
    expect(RichText::from($value)->toPlainText())->toBe($value);
    expect(RichText::from($value)->isEmpty())->toBeFalse();
})->with(['123', 'true', 'null', '[1,2]', '[]', '{"a":1}', 'use <b> for bold', '<p>not html</p>']);

it('offers explicit constructors', function () {
    expect(RichText::fromText('first' . "\n" . 'second')->getValue())->toBe([[
        'type' => 'paragraph',
        'content' => [['type' => 'text', 'text' => 'first'], ['type' => 'hardBreak'], ['type' => 'text', 'text' => 'second']],
    ]]);
    expect(RichText::fromHtml('<p><b>bold</b></p>')->toPlainText())->toBe('bold');
    expect(RichText::fromJson('[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]')->toPlainText())->toBe('a');
    expect(RichText::fromJson('[]')->getValue())->toBe([]);
    expect(RichText::fromJson('')->getValue())->toBe([]);
    expect(fn() => RichText::fromJson('{"a":1}'))->toThrow(\yii\base\InvalidArgumentException::class);
});

it('round-trips an empty document through its json form', function () {
    $json = RichText::from([])->toJson();

    expect($json)->toBe('{"type":"doc","content":[]}');
    expect(RichText::from($json)->getValue())->toBe([]);
});

it('defines empty as no visible text and no atom', function (array $content, bool $empty) {
    expect(RichText::from($content)->isEmpty())->toBe($empty);
})->with([
    [[], true],
    [[['type' => 'paragraph']], true],
    [[['type' => 'paragraph', 'content' => []]], true],
    [[paragraph("   \n\t")], true],
    [[paragraph("\u{200B}\u{FEFF}\u{2060}")], true],
    [[paragraph("\u{00A0}")], true],
    [[['type' => 'paragraph', 'content' => [['type' => 'hardBreak']]]], true],
    [[['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [['type' => 'paragraph']]]]]], true],
    [[paragraph('a')], false],
    [[['type' => 'editorAsset', 'attrs' => ['id' => 1]]], false],
    [[['type' => 'attachment', 'attrs' => ['id' => 1]]], false],
    [[['type' => 'paragraph', 'content' => [['type' => 'mention', 'attrs' => ['id' => 1, 'type' => 'user', 'label' => 'A']]]]], false],
    [[['type' => 'callout']], false],
]);

it('renders block-aware plain text with exact output', function (array $content, string $expected) {
    expect(RichText::from($content)->toPlainText())->toBe($expected);
})->with([
    'top level blocks' => [[paragraph('One'), paragraph('Two')], "One\n\nTwo"],
    'list items' => [[['type' => 'bulletList', 'content' => [
        ['type' => 'listItem', 'content' => [paragraph('One')]],
        ['type' => 'listItem', 'content' => [paragraph('Two')]],
    ]]], "One\nTwo"],
    'nested list' => [[['type' => 'bulletList', 'content' => [
        ['type' => 'listItem', 'content' => [paragraph('One'), ['type' => 'orderedList', 'content' => [['type' => 'listItem', 'content' => [paragraph('Nested')]]]]]],
        ['type' => 'listItem', 'content' => [paragraph('Two')]],
    ]]], "One\nNested\nTwo"],
    'blockquote children' => [[['type' => 'blockquote', 'content' => [paragraph('A'), paragraph('B')]], paragraph('C')], "A\nB\n\nC"],
    'hard break' => [[['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'A'], ['type' => 'hardBreak'], ['type' => 'text', 'text' => 'B']]]], "A\nB"],
    'atoms' => [[
        ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Hi '], ['type' => 'mention', 'attrs' => ['id' => 1, 'type' => 'user', 'label' => 'Al']]]],
        ['type' => 'editorAsset', 'attrs' => ['id' => 2, 'alt' => 'Photo']],
        ['type' => 'attachment', 'attrs' => ['id' => 3, 'filename' => 'Paper.pdf']],
    ], "Hi @Al\n\nPhoto\n\nPaper.pdf"],
]);

it('maps disallowed heading levels to the nearest allowed level', function (array $levels, mixed $level, ?int $expected) {
    $config = new EditorConfig(['features' => ['headings' => $levels]]);
    $node = Sanitizer::sanitize([headingNode($level)], $config)[0];

    if ($expected === null) {
        expect($node['type'])->toBe('paragraph');
    } else {
        expect($node['attrs']['level'])->toBe($expected);
    }
})->with([
    [[2, 3], 2, 2],
    [[2, 3], 1, 2],
    [[2, 3], 6, 3],
    [[2, 3], 9, 3],
    [[2, 4], 3, 2],
    [[], 2, null],
    [[2, 3], 'large', null],
]);

it('ignores invalid heading levels in an unregistered context, as the browser does', function () {
    $config = new EditorConfig(['features' => ['headings' => [9, 0, 'x', 2]]]);

    expect($config->getHeadingLevels())->toBe([2]);
    expect(Sanitizer::sanitize([headingNode(3)], $config)[0]['attrs']['level'])->toBe(2);

    $onlyInvalid = new EditorConfig(['features' => ['headings' => [9]]]);

    expect($onlyInvalid->getHeadingLevels())->toBe([]);
    expect(Sanitizer::sanitize([headingNode(2)], $onlyInvalid)[0]['type'])->toBe('paragraph');
});

it('treats headings with no levels as off and true as the browser default', function () {
    expect((new EditorConfig(['features' => ['headings' => []]]))->getHeadingLevels())->toBe([]);
    expect((new EditorConfig(['features' => ['headings' => true]]))->getHeadingLevels())->toBe([2, 3]);
    expect(Sanitizer::sanitize([headingNode(9)])[0]['attrs']['level'])->toBe(6);
});

it('keeps blocks separate when a feature is off', function () {
    $config = new EditorConfig(['features' => []]);
    $content = [
        paragraph('Intro'),
        headingNode(2),
        ['type' => 'blockquote', 'content' => [paragraph('Quote A'), paragraph('Quote B')]],
        ['type' => 'bulletList', 'content' => [
            ['type' => 'listItem', 'content' => [paragraph('One')]],
            ['type' => 'listItem', 'content' => [paragraph('Two')]],
        ]],
        ['type' => 'unknownWrapper', 'content' => [['type' => 'text', 'text' => 'Wrapped A']]],
        ['type' => 'unknownWrapper', 'content' => [['type' => 'text', 'text' => 'Wrapped B']]],
    ];

    expect(RichText::from(Sanitizer::sanitize($content, $config))->toPlainText())
        ->toBe("Intro\n\nTitle\n\nQuote A\n\nQuote B\n\nOne\n\nTwo\n\nWrapped A\n\nWrapped B");
});

it('turns a disabled mention into its label text and removes disabled media', function () {
    $config = new EditorConfig(['features' => []]);
    $content = [
        ['type' => 'paragraph', 'content' => [
            ['type' => 'text', 'text' => 'Hi '],
            ['type' => 'mention', 'attrs' => ['id' => 1, 'type' => 'user', 'label' => 'Alice']],
            ['type' => 'text', 'text' => ' ok'],
        ]],
        ['type' => 'editorAsset', 'attrs' => ['id' => 2, 'alt' => 'Photo']],
        ['type' => 'attachment', 'attrs' => ['id' => 3]],
    ];

    expect(RichText::from(Sanitizer::sanitize($content, $config))->toPlainText())->toBe('Hi @Alice ok');
});

it('requires the capability config as well as the flag', function () {
    $mention = [['type' => 'paragraph', 'content' => [['type' => 'mention', 'attrs' => ['id' => 1, 'type' => 'user', 'label' => 'Al']]]]];

    $flagOnly = new EditorConfig(['features' => ['mention' => true]]);
    $configured = new EditorConfig(['features' => ['mention' => true], 'mentions' => new MentionConfig(['enabled' => true])]);
    $flagOff = new EditorConfig(['features' => ['mention' => false], 'mentions' => new MentionConfig(['enabled' => true])]);

    expect(json_encode(Sanitizer::sanitize($mention, $flagOnly)))->not->toContain('"mention"');
    expect(json_encode(Sanitizer::sanitize($mention, $configured)))->toContain('"mention"');
    expect(json_encode(Sanitizer::sanitize($mention, $flagOff)))->not->toContain('"mention"');
});

it('stops emitting root text, orphan blocks and nested paragraphs', function () {
    $html = RichText::from([
        ['type' => 'listItem', 'content' => [paragraph('orphan item')]],
        ['type' => 'text', 'text' => 'root text'],
        headingNode(1, 'h1'),
        ['type' => 'paragraph', 'content' => [paragraph('nested p')]],
        ['type' => 'bulletList', 'content' => [paragraph('bare item')]],
        ['type' => 'bulletList', 'content' => []],
        ['type' => 'blockquote', 'content' => [['type' => 'text', 'text' => 'bare quote']]],
    ])->toHtml();

    expect($html)->toBe('<p>orphan item</p><p>root text</p><h1>h1</h1><p>nested p</p><ul><li><p>bare item</p></li></ul><blockquote><p>bare quote</p></blockquote>');
});

it('keeps empty paragraphs whichever way they are written', function () {
    expect(Sanitizer::sanitize([['type' => 'paragraph']]))->toBe([['type' => 'paragraph']]);
    expect(Sanitizer::sanitize([['type' => 'paragraph', 'content' => []]]))->toBe([['type' => 'paragraph']]);
});

it('stores reference-only structured attributes', function () {
    $config = new EditorConfig([
        'features' => ['image' => true, 'attachment' => true, 'craftLink' => true, 'mention' => true],
        'assets' => new AssetConfig(['enabled' => true]),
        'mentions' => new MentionConfig(['enabled' => true]),
        'elementLinks' => new \verbb\editor\models\ElementLinkConfig(['enabled' => true]),
    ]);

    $sanitized = Sanitizer::sanitize([
        ['type' => 'paragraph', 'content' => [
            ['type' => 'text', 'text' => 'Entry', 'marks' => [['type' => 'craftLink', 'attrs' => ['id' => 7, 'type' => 'entry', 'label' => 'Entry', 'href' => 'https://forged.example/']]]],
            ['type' => 'mention', 'attrs' => ['id' => 4, 'type' => 'user', 'label' => 'Alice', 'extra' => 'x']],
        ]],
        ['type' => 'editorAsset', 'attrs' => ['id' => 9, 'src' => 'https://forged.example/i.png', 'alt' => 'Alt', 'title' => 'Title']],
        ['type' => 'attachment', 'attrs' => ['id' => 10, 'url' => 'https://forged.example/f.pdf', 'filename' => 'F', 'mimeType' => 'application/pdf', 'size' => 5]],
    ], $config);

    expect($sanitized[0]['content'][0]['marks'][0]['attrs'])->toBe(['id' => 7, 'type' => 'entry', 'label' => 'Entry']);
    expect($sanitized[0]['content'][1]['attrs'])->toBe(['id' => 4, 'type' => 'user', 'label' => 'Alice']);
    expect($sanitized[1]['attrs'])->toBe(['id' => 9, 'alt' => 'Alt', 'title' => 'Title']);
    expect($sanitized[2]['attrs'])->toBe(['id' => 10]);
});

it('sanitises marks on inline atoms', function () {
    $config = new EditorConfig(['features' => ['mention' => true], 'mentions' => new MentionConfig(['enabled' => true])]);
    $sanitized = Sanitizer::sanitize([['type' => 'paragraph', 'content' => [
        ['type' => 'hardBreak', 'marks' => [['type' => 'link', 'attrs' => ['href' => 'javascript:alert(1)']]]],
        ['type' => 'mention', 'attrs' => ['id' => 1, 'type' => 'user', 'label' => 'A'], 'marks' => [['type' => 'evil', 'attrs' => ['x' => 'y']]]],
    ]]], $config);

    expect(json_encode($sanitized))->not->toContain('javascript:', 'evil');
});

it('keeps an ordered list start', function () {
    $list = ['type' => 'orderedList', 'attrs' => ['start' => 5], 'content' => [['type' => 'listItem', 'content' => [paragraph('Five')]]]];

    expect(RichText::from([$list])->toHtml())->toBe('<ol start="5"><li><p>Five</p></li></ol>');
    $list['attrs']['start'] = 'x';
    expect(Sanitizer::sanitize([$list])[0])->not->toHaveKey('attrs');
});

it('renders no schema attributes on public output', function () {
    $html = Tiptap::contentToHtml([
        ['type' => 'paragraph', 'content' => [
            ['type' => 'mention', 'attrs' => ['id' => 4, 'type' => 'user', 'label' => 'Alice']],
            ['type' => 'text', 'text' => 'Entry', 'marks' => [['type' => 'craftLink', 'attrs' => ['id' => 7, 'type' => 'entry', 'label' => 'Entry', 'href' => '/entry']]]],
        ]],
        ['type' => 'editorAsset', 'attrs' => ['id' => 9, 'src' => '/i.png', 'alt' => 'Alt', 'title' => 'T']],
        ['type' => 'attachment', 'attrs' => ['id' => 10, 'url' => '/f.pdf', 'filename' => 'Paper', 'mimeType' => 'application/pdf', 'size' => 1234]],
    ]);

    expect($html)->toBe(
        '<p><span data-mention-id="4" data-mention-type="user" data-label="Alice" class="verbb-editor-mention">@Alice</span>'
        . '<a href="/entry" data-craft-link-id="7" data-craft-link-type="entry" data-craft-link-label="Entry">Entry</a></p>'
        . '<img src="/i.png" alt="Alt" title="T" data-editor-asset-id="9">'
        . '<a href="/f.pdf" data-editor-attachment-id="10" data-filename="Paper" data-mime-type="application/pdf" data-size="1234" class="verbb-editor-attachment">Paper</a>',
    );
});

it('renders link attributes through the allow-list', function () {
    $link = static fn(array $attrs): string => RichText::from([['type' => 'paragraph', 'content' => [
        ['type' => 'text', 'text' => 'L', 'marks' => [['type' => 'link', 'attrs' => $attrs]]],
    ]]])->toHtml();

    expect($link(['href' => '/a']))->toBe('<p><a rel="noopener noreferrer nofollow" target="_blank" href="/a">L</a></p>');
    expect($link(['href' => '/a', 'target' => '_self', 'rel' => 'ugc onclick']))->toContain('target="_self"', 'rel="noopener noreferrer nofollow ugc"')->not->toContain('onclick');
    expect($link(['href' => '/a', 'onclick' => 'x', 'class' => 'y']))->not->toContain('onclick', 'class');
});

it('supports nl2br rendering', function () {
    $content = [paragraph('One'), paragraph('Two')];

    expect(RichText::from($content)->toHtml(true))->toBe('One<br>Two');
    expect(RichText::from($content)->toHtml())->toBe('<p>One</p><p>Two</p>');
});

it('imports html atoms without a text child', function () {
    $content = RichText::fromHtml('<p><span data-mention-id="4" data-mention-type="user" data-label="Al">@Al</span></p><a href="/f" data-editor-attachment-id="9" data-filename="F">F</a>')->getValue();

    expect($content[0]['content'][0])->not->toHaveKey('content');
    expect($content[1])->not->toHaveKey('content');
});

it('carries custom extensions on the context through import, normalise and render', function () {
    $config = new EditorConfig(['extensions' => [new ContractCallout()]]);
    $documents = new Documents();
    $richText = $documents->normalize([['type' => 'callout', 'attrs' => ['tone' => 'warning', 'bad' => 1], 'content' => [paragraph('Careful')]]], $config);

    expect($richText->getValue()[0]['attrs'])->toBe(['tone' => 'warning']);

    $html = $documents->toHtml($richText, $config);

    expect($html)->toBe('<section data-tone="warning"><p>Careful</p></section>');
    expect(RichText::fromHtml($html, $config)->getValue()[0]['type'])->toBe('callout');
    expect((new Documents())->toHtml($richText))->toBe('<p>Careful</p>');
});

it('keeps each extension set on its own memoised editor past the cap', function () {
    $content = [['type' => 'callout', 'attrs' => ['tone' => 'warning'], 'content' => [paragraph('Careful')]]];
    $configs = array_map(static fn() => new EditorConfig(['extensions' => [new ContractCallout()]]), range(1, 40));

    // Plain paragraphs render through the shared set; a mix-up would lose or misrender the custom node.
    foreach ($configs as $config) {
        expect((new Documents())->toHtml(RichText::from($content), $config))->toBe('<section data-tone="warning"><p>Careful</p></section>');
        expect((new Documents())->toHtml(RichText::from([paragraph('Plain')])))->toBe('<p>Plain</p>');
    }
});

it('applies one url rule table', function (string $url, bool $link, bool $resource) {
    expect(Sanitizer::isSafeLink($url))->toBe($link);
    expect(Sanitizer::isSafeResourceUrl($url))->toBe($resource);
})->with(function () {
    return array_map(
        static fn(array $row): array => [$row['url'], $row['link'], $row['resource']],
        json_decode(file_get_contents(dirname(__DIR__) . '/fixtures/urls.json'), true),
    );
});
