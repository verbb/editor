<?php

declare(strict_types=1);

use verbb\editor\Editor;
use Tests\Support\ResetTestDatabase;

require __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/Support/ResetTestDatabase.php';
require_once __DIR__ . '/Support/Factory.php';

try {
    $app = require CRAFT_VENDOR_PATH . '/craftcms/cms/bootstrap/console.php';
} catch (Throwable $e) {
    throw new RuntimeException(
        'Craft bootstrap failed for tests. Run `composer test:setup` and verify package `.env.testing` CRAFT_DB_* values.',
        0,
        $e
    );
}

if (!class_exists(Craft::class) || !Craft::$app) {
    throw new RuntimeException('Craft application failed to bootstrap for integration tests.');
}

$environment = getenv('ENVIRONMENT') ?: '';
if ($environment !== 'testing') {
    throw new RuntimeException('Refusing to run tests outside ENVIRONMENT=testing. Configure phpunit.craft.xml/.env.testing.');
}

$db = Craft::$app->getDb();
if (!$db->tableExists('{{%plugins}}')) {
    throw new RuntimeException(
        'Testing database is not installed yet. Run `composer test:setup` first, then re-run tests.'
    );
}

// Editor is a Yii module, not a Craft plugin, so Craft will not enable it from
// project config. Register it the same way consuming plugins do.
$editor = Editor::getInstance();
if (!$editor) {
    throw new RuntimeException('Editor module failed to load for integration tests.');
}

ResetTestDatabase::resetEditorData();
