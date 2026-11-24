<?php

declare(strict_types=1);

use verbb\editor\Editor;
use Tests\Support\ResetTestDatabase;
use Tests\Support\SampleContexts;

uses(Tests\General\TestCase::class)
    ->beforeEach(function(): void {
        // Craft 5.12 rate-limits sign-ins per address, and every HTTP test signs in from the same one.
        Craft::$app->getCache()->flush();
        ResetTestDatabase::resetEditorData();
        SampleContexts::clear(Editor::getInstance()->getEditorConfigs());
    })
    ->in(__DIR__ . '/Services');

uses()
    ->in(__DIR__ . '/Unit');
