<?php

/**
 * Creates the member the end-to-end browser test logs in as, and prints their details as JSON.
 */

declare(strict_types=1);

use Tests\Support\Factory;
use Tests\Support\ResetTestDatabase;

putenv('ENVIRONMENT=testing');
putenv('CRAFT_ENVIRONMENT=testing');

require dirname(__DIR__) . '/bootstrap.php';
require dirname(__DIR__) . '/Support/ResetTestDatabase.php';
require dirname(__DIR__) . '/Support/Factory.php';

$app = require CRAFT_VENDOR_PATH . '/craftcms/cms/bootstrap/console.php';

ResetTestDatabase::resetEditorData();
Factory::volume();
$user = Factory::user(['fullName' => 'E2e Findable']);

echo json_encode(['id' => (int)$user->id, 'username' => $user->username, 'password' => Factory::PASSWORD]);

exit(0);
