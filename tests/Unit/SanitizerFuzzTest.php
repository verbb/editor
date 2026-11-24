<?php

declare(strict_types=1);

use verbb\editor\errors\DocumentLimitException;
use verbb\editor\helpers\Sanitizer;
use verbb\editor\RichText;
use verbb\editor\services\Documents;
use Tests\Support\Xss;

/**
 * The sanitiser is the only defence for rendered document HTML, so it's fuzzed with a known XSS and
 * mutation-XSS corpus (`tests/fixtures/xss.json`), every string slot a document has, and seeded
 * random documents. Every output must pass `Xss::problems()`, which checks the markup against an
 * allow-list independently of the sanitiser.
 */

const XSS_ASSOCIATED_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];

function xssRenderings(mixed $document, bool $fromHtml = false): array
{
    $corpus = Xss::corpus();
    $context = Xss::hostileContext($corpus['urls'], $corpus['strings']);
    $documents = new Documents();
    $richText = $fromHtml ? RichText::fromHtml($document, $context) : RichText::from($document);
    $renderings = [
        'without a context' => RichText::from($fromHtml ? RichText::fromHtml($document) : $document)->toHtml(),
        'without a context, nl2br' => RichText::from($fromHtml ? RichText::fromHtml($document) : $document)->toHtml(true),
        'with a hostile context' => $documents->toHtml($richText, $context, false, XSS_ASSOCIATED_IDS),
    ];

    try {
        $saved = $documents->normalize($richText, $context);
        $renderings['saved, then rendered'] = $documents->toHtml(RichText::fromJson($saved->toJson()), $context, false, XSS_ASSOCIATED_IDS);
    } catch (DocumentLimitException) {
        // Refused at the save boundary, so it can never be stored.
    }

    return $renderings;
}

function expectSafeRenderings(array $renderings, string $source): void
{
    foreach ($renderings as $path => $html) {
        $problems = Xss::problems($html);

        expect($problems)->toBe([], "{$path}: " . json_encode($source) . "\nrendered " . json_encode($html));
    }
}

it('renders every corpus payload imported as HTML safely', function (string $payload) {
    expectSafeRenderings(xssRenderings($payload, true), $payload);
})->with(fn() => Xss::corpus()['html']);

it('renders hostile values in every string slot of a document safely', function (string $string, string $url) {
    $marks = [
        ['type' => 'bold'],
        ['type' => 'link', 'attrs' => ['href' => $url, 'target' => $string, 'rel' => $string, 'title' => $string, 'class' => $string, 'onclick' => $string]],
        ['type' => 'craftLink', 'attrs' => ['id' => 5, 'type' => 'craft\\elements\\Entry', 'label' => $string, 'href' => $url]],
        ['type' => 'textStyle', 'attrs' => ['style' => $string, 'color' => $string]],
        ['type' => $string],
    ];
    $document = [
        ['type' => 'heading', 'attrs' => ['level' => $string, 'onclick' => $string], 'content' => [['type' => 'text', 'text' => $string]]],
        ['type' => 'paragraph', 'attrs' => ['style' => $string, 'class' => $string], 'content' => [
            ['type' => 'text', 'text' => $string, 'marks' => $marks],
            ['type' => 'hardBreak', 'attrs' => ['onclick' => $string]],
            ['type' => 'mention', 'attrs' => ['id' => 3, 'type' => $string, 'label' => $string]],
            ['type' => 'mention', 'attrs' => ['id' => 4, 'type' => 'craft\\elements\\User', 'label' => $string]],
            ['type' => 'text', 'text' => $url, 'marks' => [['type' => 'code'], ['type' => 'link', 'attrs' => ['href' => $url]]]],
        ]],
        ['type' => 'orderedList', 'attrs' => ['start' => $string], 'content' => [['type' => 'listItem', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $string]]]]]]],
        ['type' => 'blockquote', 'attrs' => ['cite' => $url], 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $string]]]]],
        ['type' => 'editorAsset', 'attrs' => ['id' => 6, 'src' => $url, 'alt' => $string, 'title' => $string, 'onerror' => $string]],
        ['type' => 'attachment', 'attrs' => ['id' => 7, 'url' => $url, 'filename' => $string, 'mimeType' => $string, 'size' => $string]],
        ['type' => $string, 'attrs' => ['src' => $url], 'content' => [['type' => 'text', 'text' => $string]]],
        ['type' => 'codeBlock', 'content' => [['type' => 'text', 'text' => $string]]],
        ['type' => 'image', 'attrs' => ['src' => $url, 'alt' => $string]],
    ];

    expectSafeRenderings(xssRenderings($document), $string . ' / ' . $url);
})->with(fn() => Xss::corpus()['strings'])->with(fn() => Xss::corpus()['urls']);

it('refuses every corpus URL a browser would run, as a link and as a resource', function (string $url) {
    // Checked as stored and once decoded, because a consumer might write a stored URL into markup.
    $runnable = !Xss::isSafeUrl($url) || !Xss::isSafeUrl(Xss::decodeAttribute($url));

    expect(!$runnable || (!Sanitizer::isSafeLink($url) && !Sanitizer::isSafeResourceUrl($url)))->toBeTrue("{$url} would run, but the sanitiser keeps it");
})->with(fn() => Xss::corpus()['urls']);

/**
 * Mutation XSS works by markup that parses differently the second time. Rendered output imported
 * and rendered again must keep exactly the same elements and attributes, and reach a fixed point.
 * Only whitespace in text may change, because import collapses it.
 */
function expectStableOutput(string $first, string $source): void
{
    $second = RichText::fromHtml($first)->toHtml();
    $markup = static fn(string $html): array => preg_match_all('/<[^>]*>/', $html, $tags) ? $tags[0] : [];

    expect($markup($second))->toBe($markup($first), "markup changed when the output of {$source} was imported")
        ->and(RichText::fromHtml($second)->toHtml())->toBe($second, "no fixed point for {$source}")
        ->and(Xss::problems($second))->toBe([]);
}

it('keeps its output stable when that output is imported again', function (string $payload) {
    expectStableOutput(RichText::fromHtml($payload)->toHtml(), json_encode($payload));
})->with(fn() => Xss::corpus()['html']);

it('renders seeded random documents safely and stably', function () {
    $corpus = Xss::corpus();
    $values = [...$corpus['strings'], ...$corpus['urls'], ...array_slice($corpus['html'], 0, 20), 0, -1, 1, 7, 99999999999, 2.5, true, false, null, [], ['nested' => '<img src=x onerror=alert(1)>']];
    $types = ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'text', 'text', 'text', 'hardBreak', 'mention', 'editorAsset', 'attachment', 'codeBlock', 'image', 'table', 'script', 'iframe', 'doc', 'style', 'svg', '__proto__', ''];
    $markTypes = ['bold', 'italic', 'strike', 'underline', 'code', 'link', 'craftLink', 'textStyle', 'highlight', 'script', 'onclick'];
    $attributes = ['href', 'src', 'onerror', 'onclick', 'style', 'class', 'level', 'start', 'id', 'type', 'label', 'alt', 'title', 'filename', 'url', 'mimeType', 'size', 'target', 'rel', 'xlink:href', 'srcdoc', 'formaction', 'data-x'];

    mt_srand(20261110);

    $pick = static fn(array $list): mixed => $list[mt_rand(0, count($list) - 1)];
    $attrs = static function() use ($pick, $values, $attributes): array {
        $result = [];

        for ($i = mt_rand(0, 4); $i > 0; $i--) {
            $key = $pick($attributes);
            // References need numeric IDs to reach a provider, so give them one often.
            $result[$key] = $key === 'id' && mt_rand(0, 1) ? mt_rand(1, 30) : $pick($values);
        }

        return $result;
    };
    $node = static function(int $depth) use (&$node, $pick, $types, $markTypes, $values, $attrs): mixed {
        if (mt_rand(0, 20) === 0) {
            return $pick($values);
        }

        $type = $pick($types);
        $result = ['type' => $type];

        if (mt_rand(0, 2)) {
            $result['attrs'] = $attrs();
        }

        if ($type === 'text' || mt_rand(0, 6) === 0) {
            $result['text'] = (string)json_encode($pick($values));
        }

        if (mt_rand(0, 2) === 0) {
            $result['marks'] = array_map(static fn() => ['type' => $pick($markTypes)] + (mt_rand(0, 1) ? ['attrs' => $attrs()] : []), range(0, mt_rand(0, 2)));
        }

        if ($depth < 6 && $type !== 'text' && mt_rand(0, 3)) {
            $result['content'] = array_map(static fn() => $node($depth + 1), range(0, mt_rand(0, 3)));
        }

        return $result;
    };

    for ($i = 0; $i < 1500; $i++) {
        $document = array_map(static fn() => $node(0), range(0, mt_rand(0, 4)));
        $source = json_encode($document);

        expectSafeRenderings(xssRenderings($document), "random document {$i}: {$source}");

        expectStableOutput(RichText::from($document)->toHtml(), "random document {$i}: {$source}");
    }
});
