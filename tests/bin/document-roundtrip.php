<?php

declare(strict_types=1);

use verbb\editor\helpers\Sanitizer;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\ElementLinkConfig;
use verbb\editor\models\MentionConfig;
use verbb\editor\RichText;
use verbb\editor\services\Documents;
use Tests\Support\ContractAssets;
use Tests\Support\ContractCallout;
use Tests\Support\ContractElements;
use Tests\Support\ContractMentions;

require ($argv[1] ?? dirname(__DIR__, 2) . '/vendor') . '/autoload.php';

require_once dirname(__DIR__) . '/Support/ContractCallout.php';
require_once dirname(__DIR__) . '/Support/ContractProviders.php';

$input = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);

$config = new EditorConfig([
    'handle' => 'contract.authoring',
    'features' => [
        'bold' => true, 'italic' => true, 'strike' => true, 'underline' => true, 'code' => true, 'lists' => true, 'blockquote' => true,
        'link' => true, 'craftLink' => true, 'image' => true, 'attachment' => true, 'mention' => true, 'headings' => [2, 3],
    ],
    'extensions' => [new ContractCallout()],
    'mentions' => new MentionConfig(['enabled' => true]),
    'elementLinks' => new ElementLinkConfig(['enabled' => true]),
    'assets' => new AssetConfig(['enabled' => true]),
    'mentionProvider' => new ContractMentions(),
    'elementProvider' => new ContractElements(),
    'assetProvider' => new ContractAssets(),
]);

$documents = new Documents();
$stored = $documents->normalize($input['document'], $config);
$associated = array_map(static fn($reference) => (int)$reference->referenceId(), $stored->extractReferences());
$html = $documents->toHtml($stored, $config, associatedAssetIds: $associated);

echo json_encode([
    'stored' => $stored->getValue(),
    'html' => $html,
    'text' => $documents->toPlainText($stored, $config, $associated),
    'textLength' => $stored->getTextLength(),
    'resolved' => $documents->resolve($stored, $config, $associated)->getValue(),
    'imported' => RichText::fromHtml($html, $config)->getValue(),
    'contextFree' => RichText::from($stored)->toHtml(),
    'fitted' => array_map(static fn(array $document) => [
        'value' => RichText::from(Sanitizer::sanitize($document['content'], new EditorConfig(['features' => $document['features']])))->getValue(),
        'text' => RichText::from(Sanitizer::sanitize($document['content'], new EditorConfig(['features' => $document['features']])))->toPlainText(),
    ], $input['fitting']),
    'strings' => array_map(static fn(string $value) => RichText::from($value)->getValue(), $input['strings']),
], JSON_THROW_ON_ERROR);
