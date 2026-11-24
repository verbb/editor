<?php

declare(strict_types=1);

use verbb\editor\Editor;
use verbb\editor\enums\Capability;
use verbb\editor\enums\Feature;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\ElementLinkConfig;
use verbb\editor\models\MentionConfig;

use craft\elements\Entry;
use craft\elements\User;

use yii\base\InvalidConfigException;

it('sets itself up before anything else can ask for it', function () {
    expect(Editor::$plugin)->toBe(Editor::getInstance());
    expect(Yii::getAlias('@verbb/editor'))->toBe(realpath(dirname(__DIR__, 2) . '/src'));
    expect(array_keys(Editor::getInstance()->getComponents()))->toBe(['assets', 'documents', 'editorConfigs', 'elements', 'mentions']);
    expect(property_exists(Editor::class, 'handle'))->toBeFalse();
});

it('throws on a duplicate handle unless replacing', function () {
    $configs = Editor::getInstance()->getEditorConfigs();
    $first = new EditorConfig(['handle' => 'sample.reply']);
    $second = new EditorConfig(['handle' => 'sample.reply']);

    $configs->registerConfig($first);

    expect(fn() => $configs->registerConfig($second))->toThrow(InvalidConfigException::class);
    expect($configs->requireConfigByHandle('sample.reply'))->toBe($first);

    $configs->registerConfig($second, true);

    expect($configs->requireConfigByHandle('sample.reply'))->toBe($second);
});

it('validates the handle and config on registration', function (array $settings) {
    expect(fn() => Editor::getInstance()->getEditorConfigs()->registerConfig(new EditorConfig($settings)))->toThrow(InvalidConfigException::class);
})->with([
    'no handle' => [[]],
    'not namespaced' => [['handle' => 'reply']],
    'uppercase' => [['handle' => 'Sample.Reply']],
    'spaces' => [['handle' => 'sample. reply']],
    'unknown feature' => [['handle' => 'sample.x', 'features' => ['bolder' => true]]],
    'bad heading level' => [['handle' => 'sample.x', 'features' => ['headings' => [9]]]],
    'bad limit' => [['handle' => 'sample.x', 'maxNodes' => 0]],
    'bad extension' => [['handle' => 'sample.x', 'extensions' => ['nope']]],
    'bad authorize' => [['handle' => 'sample.x', 'authorize' => 'no_such_function']],
    'bad resolveScope' => [['handle' => 'sample.x', 'resolveScope' => 'no_such_function']],
    'bad asset config' => [['handle' => 'sample.x', 'assets' => new AssetConfig(['maxFileSize' => 0])]],
    'bad mention limit' => [['handle' => 'sample.x', 'mentions' => new MentionConfig(['limit' => 51])]],
    'bad mention callable' => [['handle' => 'sample.x', 'mentions' => new MentionConfig(['eligibleIds' => 'no_such_function'])]],
    'bad element limit' => [['handle' => 'sample.x', 'elementLinks' => new ElementLinkConfig(['limit' => 51])]],
    'bad element type' => [['handle' => 'sample.x', 'elementLinks' => new ElementLinkConfig(['elementTypes' => ['stdClass']])]],
    'criteria for an unlisted type' => [['handle' => 'sample.x', 'elementLinks' => new ElementLinkConfig(['elementTypes' => [Entry::class], 'criteria' => [User::class => []]])]],
]);

it('gates resource features on their capability config', function () {
    $config = new EditorConfig(['features' => [
        'bold' => true, 'mention' => true, 'image' => true, 'attachment' => true, 'craftLink' => true, 'headings' => [],
    ]]);

    expect($config->isEnabled(Feature::Bold))->toBeTrue();
    expect($config->isEnabled(Feature::Italic))->toBeFalse();
    expect($config->isEnabled(Feature::Headings))->toBeFalse();
    expect($config->isEnabled(Feature::Mention))->toBeFalse();
    expect($config->isEnabled(Feature::Image))->toBeFalse();
    expect($config->isEnabled(Feature::CraftLink))->toBeFalse();

    $config->mentions = new MentionConfig(['enabled' => true]);
    $config->assets = new AssetConfig(['enabled' => false]);
    $config->elementLinks = new ElementLinkConfig(['enabled' => true]);

    expect($config->isEnabled(Feature::Mention))->toBeTrue();
    expect($config->isEnabled(Feature::Image))->toBeFalse();
    expect($config->isEnabled(Feature::CraftLink))->toBeTrue();
});

it('passes the user, capability string and config to authorize', function () {
    $user = new User();
    $seen = [];
    $config = new EditorConfig(['authorize' => function(User $u, string $capability, EditorConfig $c) use (&$seen) {
        $seen[] = [$u, $capability, $c];

        return $capability === 'mentions';
    }]);

    expect($config->authorizeUser($user, Capability::Mentions))->toBeTrue();
    expect($config->authorizeUser($user, Capability::Upload))->toBeFalse();
    expect($seen[0])->toBe([$user, 'mentions', $config]);
    expect((new EditorConfig())->authorizeUser($user, Capability::Upload))->toBeTrue();
});

it('gives guests basic editing and no resources in browser options', function () {
    $config = new EditorConfig([
        'handle' => 'sample.reply',
        'placeholder' => 'Reply',
        'labels' => ['bold' => 'Fett'],
        'features' => ['bold' => true, 'mention' => true, 'headings' => [2, 3]],
        'mentions' => new MentionConfig(['enabled' => true]),
    ]);

    $options = $config->browserOptions();

    expect($options['craft'])->toBeFalse();
    expect($options['features']['bold'])->toBeTrue();
    expect($options['features']['mention'])->toBeFalse();
    expect($options['features']['italic'])->toBeFalse();
    expect($options['features']['headings'])->toBe([2, 3]);
    expect($options['placeholder'])->toBe('Reply');
    expect($options['labels']['bold'])->toBe('Fett');
    expect($options['labels']['italic'])->toBe('Italic');
    expect(array_keys($options['features']))->toEqualCanonicalizing(array_map(static fn(Feature $f) => $f->value, Feature::cases()));
});

it('lists every server string in the translation file', function () {
    $translations = require dirname(__DIR__, 2) . '/src/translations/en/editor.php';

    foreach (verbb\editor\helpers\Labels::DEFAULTS as $label) {
        expect($translations)->toHaveKey($label);
    }

    foreach (glob(dirname(__DIR__, 2) . '/src/*/*.php') + glob(dirname(__DIR__, 2) . '/src/*/*/*.php') as $file) {
        preg_match_all("/Craft::t\('editor', '((?:[^'\\\\]|\\\\.)*)'/", file_get_contents($file), $matches);

        foreach ($matches[1] as $message) {
            expect($translations)->toHaveKey(stripslashes($message));
        }
    }
});
