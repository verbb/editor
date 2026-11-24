<?php
/**
 * Prints, as JSON, what Editor's PHP renderer makes of every XSS corpus payload, for the browser
 * test that loads that HTML into a real page. Used by `tests/browser/xss.spec.ts`.
 */

declare(strict_types=1);

use Tests\Support\Xss;
use verbb\editor\RichText;
use verbb\editor\services\Documents;

require dirname(__DIR__, 2) . '/vendor/autoload.php';

$corpus = Xss::corpus();
$context = Xss::hostileContext($corpus['urls'], $corpus['strings']);
$documents = new Documents();
$associated = range(1, 25);
$rendered = [];

foreach ($corpus['html'] as $payload) {
    $rendered[] = ['source' => $payload, 'html' => RichText::fromHtml($payload)->toHtml()];
    $rendered[] = ['source' => $payload, 'html' => $documents->toHtml(RichText::fromHtml($payload, $context), $context, false, $associated)];
}

foreach ($corpus['strings'] as $index => $string) {
    $url = $corpus['urls'][$index % count($corpus['urls'])];
    $document = [
        ['type' => 'paragraph', 'content' => [
            ['type' => 'text', 'text' => $string, 'marks' => [['type' => 'link', 'attrs' => ['href' => $url, 'rel' => $string, 'target' => $string]]]],
            ['type' => 'mention', 'attrs' => ['id' => $index + 1, 'type' => 'craft\\elements\\User', 'label' => $string]],
            ['type' => 'text', 'text' => $string, 'marks' => [['type' => 'craftLink', 'attrs' => ['id' => $index + 1, 'type' => 'craft\\elements\\Entry', 'label' => $string]]]],
        ]],
        ['type' => 'editorAsset', 'attrs' => ['id' => $index + 1, 'alt' => $string, 'title' => $string]],
        ['type' => 'attachment', 'attrs' => ['id' => $index + 2]],
    ];

    $rendered[] = ['source' => "{$string} / {$url}", 'html' => $documents->toHtml(RichText::from($document), $context, false, $associated)];
}

echo json_encode($rendered, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
