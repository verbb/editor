<?php

declare(strict_types=1);

use verbb\editor\Editor;
use verbb\editor\enums\Capability;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\ElementLinkConfig;
use verbb\editor\models\GifConfig;
use verbb\editor\models\MentionConfig;
use Tests\Support\Factory;

use craft\console\Request as ConsoleRequest;
use craft\elements\Asset;
use craft\elements\Entry;
use craft\elements\User;

use yii\web\BadRequestHttpException;
use yii\web\ForbiddenHttpException;
use yii\web\NotFoundHttpException;

function suggestionContext(array $mentions = [], array $links = []): EditorConfig
{
    return new EditorConfig([
        'handle' => 'sample.suggestions',
        'features' => ['mention' => true, 'craftLink' => true],
        'mentions' => new MentionConfig(['enabled' => true] + $mentions),
        'elementLinks' => new ElementLinkConfig(['enabled' => true, 'elementTypes' => [Entry::class]] + $links),
    ]);
}

function browseAs(?User $user): void
{
    Craft::$app->getUser()->setIdentity($user);
}

it('suggests the people a context names before a name is typed', function () {
    $b = Factory::user(['fullName' => 'Thread Bravo']);
    $a = Factory::user(['fullName' => 'Thread Alpha']);
    Factory::user(['fullName' => 'Thread Outsider']);
    browseAs(Factory::user(['fullName' => 'Viewer']));
    $seen = null;
    $config = suggestionContext(['limit' => 5, 'eligibleIds' => function(array $context) use (&$seen, $a, $b) {
        $seen = $context;

        return [$b->id, $a->id];
    }]);
    $config->referenceContext = ['ownerId' => 3];

    expect(array_column(Editor::getInstance()->getMentions()->search('', $config), 'label'))->toBe(['Thread Alpha', 'Thread Bravo']);
    expect($seen)->toBe(['ownerId' => 3]);

    $config->mentions->limit = 1;

    expect(array_column(Editor::getInstance()->getMentions()->search('   ', $config), 'label'))->toBe(['Thread Alpha']);
});

it('suggests only people the viewer may see when the context requires it', function () {
    $other = Factory::user(['fullName' => 'Unseen Person']);
    $viewer = Factory::user(['fullName' => 'Seen Viewer']);
    browseAs($viewer);
    $config = suggestionContext(['eligibleIds' => static fn() => [$other->id, $viewer->id]]);
    $config->requireViewPermission = true;

    // Without the permission to view users, a member can only view themselves.
    expect(array_column(Editor::getInstance()->getMentions()->search('', $config), 'label'))->toBe(['Seen Viewer']);

    $config->requireViewPermission = false;

    expect(array_column(Editor::getInstance()->getMentions()->search('', $config), 'label'))->toBe(['Seen Viewer', 'Unseen Person']);
});

it('suggests nobody from criteria alone, and nothing to guests', function () {
    Factory::user(['fullName' => 'Everyone Person']);
    browseAs(Factory::user(['fullName' => 'Viewer']));

    expect(Editor::getInstance()->getMentions()->search('', suggestionContext(['criteria' => []])))->toBe([]);

    $person = Factory::user(['fullName' => 'Named Person']);
    browseAs(null);

    expect(Editor::getInstance()->getMentions()->search('', suggestionContext(['eligibleIds' => static fn() => [$person->id]])))->toBe([]);
});

it('adds a description from the context, and only a reference is ever stored', function () {
    $pat = Factory::user(['fullName' => 'Described Pat']);
    browseAs(Factory::user(['fullName' => 'Viewer']));
    $config = suggestionContext([
        'criteria' => [],
        'describe' => static fn(User $user, array $context, EditorConfig $editorConfig) => $user->id === $pat->id ? '  Author  ' : '',
    ]);

    $results = Editor::getInstance()->getMentions()->search('Described', $config);

    expect($results)->toBe([['id' => (int)$pat->id, 'type' => User::class, 'label' => 'Described Pat', 'description' => 'Author']]);
    expect(Editor::getInstance()->getMentions()->resolve(['id' => $pat->id, 'type' => User::class, 'label' => 'x'], $config))
        ->toBe(['id' => (int)$pat->id, 'type' => User::class, 'label' => 'Described Pat']);
});

it('refuses a description that is not callable', function () {
    $config = new MentionConfig(['enabled' => true, 'describe' => 'not a function']);

    expect($config->validate())->toBeFalse();
    expect((new ElementLinkConfig(['describe' => 'nope']))->validate())->toBeFalse();
});

it('adds an avatar from a user photo with a public URL', function () {
    $volume = Factory::volume();
    $file = Factory::uploadedImage('avatar.png');
    $asset = new Asset();
    $asset->tempFilePath = $file->tempName;
    $asset->setFilename('avatar.png');
    $asset->newFolderId = Craft::$app->getAssets()->getRootFolderByVolumeId($volume->id)->id;
    $asset->setVolumeId($volume->id);
    $asset->avoidFilenameConflicts = true;
    $asset->setScenario(Asset::SCENARIO_CREATE);
    expect(Craft::$app->getElements()->saveElement($asset))->toBeTrue();

    // Craft keeps user photos in the volume project config names.
    Craft::$app->getProjectConfig()->set('users.photoVolumeUid', $volume->uid);
    $user = Factory::user(['fullName' => 'Pictured Person']);
    $user->photoId = $asset->id;
    expect(Craft::$app->getElements()->saveElement($user, false))->toBeTrue();
    Factory::user(['fullName' => 'Pictured Nobody']);
    browseAs(Factory::user(['fullName' => 'Viewer']));

    $results = array_column(Editor::getInstance()->getMentions()->search('Pictured', suggestionContext(['criteria' => []])), null, 'label');

    expect($results['Pictured Person']['imageUrl'])->toBeString()->not->toBe('');
    expect($results['Pictured Nobody'])->not->toHaveKey('imageUrl');
});

it('suggests pages before a search, and describes each by its section', function () {
    $section = Factory::section();
    $entry = Factory::entry($section, 'Suggested story');
    $hidden = Factory::entry($section, 'Hidden suggestion', false);
    browseAs(Factory::user());

    $results = array_column(Editor::getInstance()->getElements()->search('', suggestionContext()), null, 'id');

    expect($results)->toHaveKey((int)$entry->id)->not->toHaveKey((int)$hidden->id);
    expect($results[(int)$entry->id])->toMatchArray([
        'type' => Entry::class,
        'label' => (string)Entry::find()->id($entry->id)->one(),
        'url' => $entry->getUrl(),
        'description' => $section->name,
    ]);

    // One character matches almost everything, so it waits for another.
    expect(Editor::getInstance()->getElements()->search('S', suggestionContext()))->toBe([]);

    browseAs(null);
    expect(Editor::getInstance()->getElements()->search('', suggestionContext()))->toBe([]);
});

it('takes a page description from the context', function () {
    $entry = Factory::entry(Factory::section(), 'Custom story');
    browseAs(Factory::user());
    $config = suggestionContext([], ['describe' => static fn(Entry $element, EditorConfig $context): string => 'Guide · ' . $element->id]);

    $results = array_column(Editor::getInstance()->getElements()->search('', $config), null, 'id');

    expect($results[(int)$entry->id]['description'])->toBe('Guide · ' . $entry->id);
});

it('sends per-document upload counts to the browser', function () {
    browseAs(Factory::user());
    $config = new EditorConfig([
        'handle' => 'sample.counts',
        'features' => ['image' => true, 'attachment' => true],
        'assets' => new AssetConfig(['enabled' => true, 'allowedExtensions' => ['png'], 'maxImages' => 4, 'maxAttachments' => 2]),
    ]);

    expect($config->browserOptions()['craft']['uploads'])->toMatchArray(['maxImages' => 4, 'maxAttachments' => 2]);
    expect($config->browserOptions())->not->toHaveKey('theme');
});

it('sends GIF search to guests and members only with a key, and refuses a rating GIPHY doesn’t have', function () {
    browseAs(null);
    $config = new EditorConfig([
        'handle' => 'sample.gifs',
        'gifs' => new GifConfig(['apiKey' => 'giphy-key', 'rating' => 'pg', 'limit' => 12, 'language' => 'fr-CA']),
    ]);

    expect($config->browserOptions()['gifs'])->toBe(['apiKey' => 'giphy-key', 'rating' => 'pg', 'limit' => 12, 'language' => 'fr']);

    browseAs(Factory::user());
    expect($config->browserOptions())->toHaveKey('gifs');

    $config->gifs = new GifConfig(['apiKey' => '']);
    expect($config->browserOptions())->not->toHaveKey('gifs');

    $config->gifs = new GifConfig(['apiKey' => 'giphy-key', 'enabled' => false]);
    expect($config->browserOptions())->not->toHaveKey('gifs');

    $config->gifs = new GifConfig(['apiKey' => 'giphy-key', 'rating' => 'nc-17']);
    expect($config->validate())->toBeFalse();
});

it('sends enabled features to a consumer’s own endpoints', function () {
    browseAs(Factory::user());
    $config = new EditorConfig([
        'handle' => 'sample.routed',
        'features' => ['mention' => true, 'image' => true, 'craftLink' => false],
        'mentions' => new MentionConfig(['enabled' => true]),
        'assets' => new AssetConfig(['enabled' => true, 'allowedExtensions' => ['png']]),
    ]);

    $endpoints = $config->browserOptions(['ownerId' => 3], [
        'mentions' => '/actions/comments/api/mentions',
        'upload' => '/actions/comments/api/upload',
        'elements' => '/actions/comments/api/elements',
    ])['craft']['endpoints'];

    expect($endpoints)->toBe(['upload' => '/actions/comments/api/upload', 'mentions' => '/actions/comments/api/mentions']);
    expect($config->browserOptions()['craft']['endpoints']['mentions'])->toContain('verbb-editor/mentions/search');
});

it('refuses an unknown endpoint override', function (array $endpoints) {
    $config = new EditorConfig(['handle' => 'sample.routed', 'features' => ['mention' => true]]);

    expect(fn() => $config->browserOptions(null, $endpoints))->toThrow(InvalidArgumentException::class);
})->with([
    'unknown name' => [['search' => '/actions/x']],
    'empty URL' => [['mentions' => '']],
    'not a string' => [['mentions' => ['/actions/x']]],
]);

it('gives the editor the Control Panel theme on CP requests', function () {
    $request = Craft::$app->getRequest();
    $cpRequest = new class() extends ConsoleRequest {
        public function getIsCpRequest(): bool
        {
            return true;
        }
    };

    Craft::$app->set('request', $cpRequest);

    try {
        expect((new EditorConfig(['handle' => 'sample.cp', 'features' => ['bold' => true]]))->browserOptions()['theme'])->toBe('craft');
    } finally {
        Craft::$app->set('request', $request);
    }
});

it('answers an empty query through the real endpoint', function () {
    Factory::volume();
    $user = Factory::user(['fullName' => 'Http Suggested']);
    $session = new Tests\Support\HttpSession();
    $session->login($user->username);

    // A context that names who's eligible suggests them; criteria alone suggest nobody.
    $scoped = $session->post('/actions/verbb-editor/mentions/search', ['context' => 'http.scoped', 'scope' => ['ownerId' => 7], 'query' => '']);
    $open = $session->post('/actions/verbb-editor/mentions/search', ['context' => 'http.open', 'query' => '']);

    expect($scoped['status'])->toBe(200);
    expect(array_column($scoped['json']['results'], 'id'))->toContain((int)$user->id);
    expect($open['status'])->toBe(200);
    expect($open['json'])->toBe(['results' => []]);
});

it('checks a consumer endpoint’s request the way Editor’s own endpoints do', function () {
    $member = Factory::user();
    $configs = Editor::getInstance()->getEditorConfigs();
    $configs->registerConfig(new EditorConfig([
        'handle' => 'sample.consumer',
        'features' => ['mention' => true],
        'mentions' => new MentionConfig(['enabled' => true]),
        'resolveScope' => static fn(array $scope, User $user): ?array => ($scope['ownerId'] ?? null) === 3 ? ['owner' => 3] : null,
        'authorize' => static fn(User $user, string $capability): bool => $capability === 'mentions',
    ]));

    // Multipart uploads send scope as a JSON string, and JSON requests as an object.
    expect($configs->resolveRequestConfig('sample.consumer', ['ownerId' => 3], $member, Capability::Mentions)->referenceContext)->toBe(['owner' => 3])
        ->and($configs->resolveRequestConfig('sample.consumer', '{"ownerId":3}', $member, Capability::Mentions)->referenceContext)->toBe(['owner' => 3])
        ->and($configs->getConfigByHandle('sample.consumer')->referenceContext)->toBe([]);

    expect(fn() => $configs->resolveRequestConfig('sample.missing', [], $member, Capability::Mentions))->toThrow(NotFoundHttpException::class)
        ->and(fn() => $configs->resolveRequestConfig(['sample.consumer'], [], $member, Capability::Mentions))->toThrow(NotFoundHttpException::class)
        ->and(fn() => $configs->resolveRequestConfig('sample.consumer', ['ownerId' => 3], null, Capability::Mentions))->toThrow(ForbiddenHttpException::class)
        ->and(fn() => $configs->resolveRequestConfig('sample.consumer', ['ownerId' => 4], $member, Capability::Mentions))->toThrow(ForbiddenHttpException::class)
        ->and(fn() => $configs->resolveRequestConfig('sample.consumer', '{not json', $member, Capability::Mentions))->toThrow(BadRequestHttpException::class)
        ->and(fn() => $configs->resolveRequestConfig('sample.consumer', ['ownerId' => 3], $member, Capability::Upload))->toThrow(ForbiddenHttpException::class);
});
