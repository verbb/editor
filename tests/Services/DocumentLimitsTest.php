<?php

declare(strict_types=1);

use verbb\editor\errors\DocumentLimitException;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use verbb\editor\RichText;
use verbb\editor\services\Documents;

function limitParagraph(string $text): array
{
    return ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $text]]];
}

it('enforces document limits when normalising with a typed exception', function (array $settings, array $content) {
    $config = new EditorConfig($settings + ['features' => ['lists' => true, 'image' => true, 'attachment' => true]]);

    expect(fn() => (new Documents())->normalize($content, $config))->toThrow(DocumentLimitException::class);
    // Rendering stored content never throws, even when it no longer fits a lowered limit.
    expect((new Documents())->toHtml(RichText::from($content), $config))->toBeString();
})->with([
    'nodes' => [['maxNodes' => 2], [limitParagraph('a'), limitParagraph('b')]],
    'depth' => [['maxDepth' => 1], [limitParagraph('a')]],
    'bytes' => [['maxBytes' => 10], [limitParagraph('long enough')]],
    'images' => [['assets' => new AssetConfig(['enabled' => true, 'maxImages' => 1])], [['type' => 'editorAsset', 'attrs' => ['id' => 1]], ['type' => 'editorAsset', 'attrs' => ['id' => 2]]]],
    'attachments' => [['assets' => new AssetConfig(['enabled' => true, 'maxAttachments' => 1])], [['type' => 'attachment', 'attrs' => ['id' => 1]], ['type' => 'attachment', 'attrs' => ['id' => 2]]]],
]);

it('has default limits of 10000 nodes, depth 32 and 512 KB', function () {
    $config = new EditorConfig();

    expect([$config->maxNodes, $config->maxDepth, $config->maxBytes])->toBe([10000, 32, 524288]);
    expect(fn() => (new Documents())->normalize(str_repeat('a', 524289)))->toThrow(DocumentLimitException::class);
});
