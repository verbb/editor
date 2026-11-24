<?php

declare(strict_types=1);

namespace Tests\Support;

use Craft;
use craft\elements\Asset;
use craft\elements\Entry;
use craft\elements\User;

class ResetTestDatabase
{
    /**
     * Refuses anything but the disposable test environment, then removes what tests created.
     */
    public static function resetEditorData(): void
    {
        if ((getenv('ENVIRONMENT') ?: '') !== 'testing') {
            throw new \RuntimeException('Refusing to reset data outside ENVIRONMENT=testing.');
        }

        $elements = Craft::$app->getElements();
        Craft::$app->getUser()->setIdentity(null);

        foreach (Asset::find()->status(null)->all() as $asset) {
            $elements->deleteElement($asset, true);
        }

        foreach (Entry::find()->status(null)->all() as $entry) {
            $elements->deleteElement($entry, true);
        }

        foreach (User::find()->status(null)->email('*@' . Factory::EMAIL_DOMAIN)->all() as $user) {
            $elements->deleteElement($user, true);
        }
    }
}
