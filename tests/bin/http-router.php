<?php

/**
 * `php -S` router running real Craft requests against the disposable test database, so controller
 * tests cover login, CSRF and response handling rather than calling actions directly.
 */

declare(strict_types=1);

use verbb\editor\Editor;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\MentionConfig;
use verbb\editor\base\MentionProviderInterface;

$uriPath = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$distPath = dirname(__DIR__, 2) . '/src/web/assets/editor/dist/';

// The editor and the chunks it loads on demand, which sit beside it in the bundle folder.
if (preg_match('#^/__dist/([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(js|css))$#', $uriPath, $match) && is_file($distPath . $match[1])) {
    header('Content-Type: ' . ($match[2] === 'js' ? 'text/javascript' : 'text/css'));
    readfile($distPath . $match[1]);

    return;
}

$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['PHP_SELF'] = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = dirname(__DIR__) . '/_craft/web/index.php';

putenv('ENVIRONMENT=testing');
putenv('CRAFT_ENVIRONMENT=testing');

require dirname(__DIR__) . '/bootstrap.php';

if ((getenv('ENVIRONMENT') ?: '') !== 'testing') {
    http_response_code(500);
    exit('Refusing to run outside ENVIRONMENT=testing.');
}

$app = require CRAFT_VENDOR_PATH . '/craftcms/cms/bootstrap/web.php';

Editor::bootstrap();

$volume = Craft::$app->getVolumes()->getVolumeByHandle('editorTest');
$configs = Editor::getInstance()->getEditorConfigs();

$assets = static fn(array $settings = []): AssetConfig => new AssetConfig($settings + [
    'enabled' => true,
    'volumeId' => $volume?->id,
    'allowedExtensions' => ['png', 'txt'],
    'maxFileSize' => 1024 * 1024,
]);

$open = [
    'features' => ['bold' => true, 'mention' => true, 'image' => true, 'attachment' => true],
    'mentions' => new MentionConfig(['enabled' => true, 'criteria' => []]),
    'assets' => $assets(),
];

$configs->registerConfig(new EditorConfig(['handle' => 'http.open'] + $open));
$configs->registerConfig(new EditorConfig(['handle' => 'http.denied', 'authorize' => static fn() => false] + $open));
$configs->registerConfig(new EditorConfig(['handle' => 'http.capability', 'authorize' => static fn($user, string $capability) => $capability === 'mentions'] + $open));
$configs->registerConfig(new EditorConfig(['handle' => 'http.off', 'features' => ['bold' => true]]));
$configs->registerConfig(new EditorConfig(['handle' => 'http.small', 'assets' => $assets(['maxFileSize' => 1])] + $open));

// The scope callable is the only way a client value reaches `referenceContext`.
$configs->registerConfig(new EditorConfig([
    'handle' => 'http.scoped',
    'resolveScope' => static fn(array $scope, $user, EditorConfig $config): ?array => ($scope['ownerId'] ?? null) === 7 ? ['ownerId' => 7, 'by' => (int)$user->id] : null,
    'authorize' => static fn($user, string $capability, EditorConfig $config): bool => ($config->referenceContext['ownerId'] ?? null) === 7,
    'features' => $open['features'],
    'assets' => $open['assets'],
    'mentions' => new MentionConfig([
        'enabled' => true,
        'eligibleIds' => static function(array $context): array {
            header('X-Reference-Context: ' . json_encode($context));

            return array_map('intval', craft\elements\User::find()->status(null)->ids());
        },
    ]),
]));

$configs->registerConfig(new EditorConfig([
    'handle' => 'http.broken',
    'features' => ['mention' => true],
    'mentions' => new MentionConfig(['enabled' => true]),
    'mentionProvider' => new class implements MentionProviderInterface {
        public function search(string $query, MentionConfig $config, EditorConfig $context): array
        {
            throw new RuntimeException('Secret internal detail');
        }

        public function resolve(array $reference, MentionConfig $config, EditorConfig $context): ?array
        {
            return null;
        }

        public function resolveAll(array $references, MentionConfig $config, EditorConfig $context): array
        {
            return [];
        }
    },
]));

// What a consumer's template would emit, for checking the whole path from PHP to the browser.
if ($uriPath === '/__options') {
    header('Content-Type: application/json');
    echo json_encode($configs->requireConfigByHandle($_GET['context'] ?? 'http.open')->browserOptions(isset($_GET['scope']) ? json_decode($_GET['scope'], true) : null));

    exit;
}

if ($uriPath === '/__e2e') {
    $options = $configs->requireConfigByHandle($_GET['context'] ?? 'http.open')->browserOptions();
    header('Content-Type: text/html');
    echo '<!doctype html><link rel="stylesheet" href="/__dist/editor.css"><div id="editor"></div><script type="module">'
        . 'import { Editor } from "/__dist/editor.js";'
        . 'window.editor = await Editor.create("#editor", ' . json_encode($options) . ');'
        . 'window.editorReady = true;'
        . '</script>';

    exit;
}

$app->run();
