<?php

declare(strict_types=1);

use verbb\editor\base\ElementProviderInterface;
use verbb\editor\base\MentionProviderInterface;
use verbb\editor\Editor;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\ElementLinkConfig;
use verbb\editor\models\MentionConfig;
use verbb\editor\RichText;
use verbb\editor\services\Documents;
use Tests\Support\Factory;

use craft\elements\Asset;
use craft\elements\Entry;
use craft\elements\User;

function mentionDocument(int $id, string $label = 'Stored'): RichText
{
    return RichText::from([['type' => 'paragraph', 'content' => [
        ['type' => 'text', 'text' => 'Hi '],
        ['type' => 'mention', 'attrs' => ['id' => $id, 'type' => User::class, 'label' => $label]],
    ]]]);
}

function linkDocument(int $id, string $type = Entry::class): RichText
{
    return RichText::from([['type' => 'paragraph', 'content' => [
        ['type' => 'text', 'text' => 'Read this', 'marks' => [['type' => 'craftLink', 'attrs' => ['id' => $id, 'type' => $type, 'label' => 'Stored']]]],
    ]]]);
}

function mentionConfig(array $mentions = ['criteria' => []]): EditorConfig
{
    return new EditorConfig([
        'handle' => 'sample.mentions',
        'features' => ['mention' => true],
        'mentions' => new MentionConfig(['enabled' => true] + $mentions),
    ]);
}

function linkConfig(array $links = []): EditorConfig
{
    return new EditorConfig([
        'handle' => 'sample.links',
        'features' => ['craftLink' => true],
        'elementLinks' => new ElementLinkConfig(['enabled' => true, 'elementTypes' => [Entry::class]] + $links),
    ]);
}

function savedImage(string $name = 'photo.png', ?int $folderId = null): Asset
{
    $volume = Factory::volume();
    $folder = $folderId ? Craft::$app->getAssets()->getFolderById($folderId) : Craft::$app->getAssets()->getRootFolderByVolumeId($volume->id);
    $file = Factory::uploadedImage($name);
    $asset = new Asset();
    $asset->tempFilePath = $file->tempName;
    $asset->setFilename($name);
    $asset->newFolderId = $folder->id;
    $asset->setVolumeId($volume->id);
    $asset->avoidFilenameConflicts = true;
    $asset->setScenario(Asset::SCENARIO_CREATE);

    if (!Craft::$app->getElements()->saveElement($asset)) {
        throw new RuntimeException(implode(' ', $asset->getFirstErrors()));
    }

    return $asset;
}

function assetConfig(array $assets = []): EditorConfig
{
    return new EditorConfig([
        'handle' => 'sample.assets',
        'features' => ['image' => true, 'attachment' => true],
        'assets' => new AssetConfig($assets + ['enabled' => true, 'volumeId' => Factory::volume()->id, 'allowedExtensions' => ['png', 'txt']]),
    ]);
}

function viewAs(?User $user): void
{
    Craft::$app->getUser()->setIdentity($user);
}

it('renders the same mentions for guests, members and admins', function () {
    $mentioned = Factory::user(['fullName' => 'Pat Example']);
    $documents = Editor::getInstance()->getDocuments();
    $html = [];

    foreach ([null, Factory::user(), User::find()->admin()->one()] as $viewer) {
        viewAs($viewer);
        $html[] = $documents->toHtml(mentionDocument($mentioned->id), mentionConfig());
    }

    expect(array_unique($html))->toHaveCount(1);
    expect($html[0])->toContain('>@Pat Example</span>', 'data-mention-id="' . $mentioned->id . '"');
});

it('only lets a context opt in to view permissions', function () {
    $mentioned = Factory::user(['fullName' => 'Pat Example']);
    $config = mentionConfig();
    $config->requireViewPermission = true;
    viewAs(null);

    $html = Editor::getInstance()->getDocuments()->toHtml(mentionDocument($mentioned->id, 'Stored name'), $config);

    expect($html)->toBe('<p>Hi @Stored name</p>');
});

it('falls back to the stored label as unlinked text', function () {
    $inactive = Factory::user(['fullName' => 'Gone', 'suspended' => true]);
    $documents = Editor::getInstance()->getDocuments();

    foreach ([$inactive->id, 999999] as $id) {
        $richText = mentionDocument($id, 'Stored name');

        expect($documents->toHtml($richText, mentionConfig()))->toBe('<p>Hi @Stored name</p>');
        expect($documents->toPlainText($richText, mentionConfig()))->toBe('Hi @Stored name');
    }
});

it('treats a forged reference type as unresolved', function () {
    $user = Factory::user(['fullName' => 'Pat']);
    $richText = RichText::from([['type' => 'paragraph', 'content' => [
        ['type' => 'mention', 'attrs' => ['id' => $user->id, 'type' => Entry::class, 'label' => 'Forged']],
    ]]]);

    expect(Editor::getInstance()->getDocuments()->toHtml($richText, mentionConfig()))->toBe('<p>@Forged</p>');
});

it('makes nobody mentionable until the context says who', function () {
    $user = Factory::user(['fullName' => 'Pat Example']);
    viewAs($user);
    $config = mentionConfig([]);

    expect(Editor::getInstance()->getMentions()->search('Pat', $config))->toBe([]);
    expect(Editor::getInstance()->getDocuments()->toHtml(mentionDocument($user->id, 'Pat'), $config))->toBe('<p>Hi @Pat</p>');
});

it('searches name fields only and returns references', function () {
    $pat = Factory::user(['fullName' => 'Pat Example', 'email' => 'secretaddress@' . Factory::EMAIL_DOMAIN]);
    $viewer = Factory::user(['fullName' => 'Viewer']);
    viewAs($viewer);
    $mentions = Editor::getInstance()->getMentions();

    expect($mentions->search('Pat Ex', mentionConfig()))->toBe([['id' => (int)$pat->id, 'type' => User::class, 'label' => 'Pat Example']]);
    expect($mentions->search('secretaddress', mentionConfig()))->toBe([]);
    expect($mentions->search(Factory::EMAIL_DOMAIN, mentionConfig()))->toBe([]);
});

it('never searches or publishes an email used as a username', function () {
    $viewer = Factory::user(['fullName' => 'Viewer']);
    $email = 'namedless' . bin2hex(random_bytes(3)) . '@' . Factory::EMAIL_DOMAIN;
    $user = Factory::user(['username' => $email, 'email' => $email]);
    viewAs($viewer);

    expect(Editor::getInstance()->getMentions()->search('namedless', mentionConfig()))->toBe([]);
    expect(Editor::getInstance()->getDocuments()->toHtml(mentionDocument($user->id, 'Stored'), mentionConfig()))->toContain('>@Stored</span>')->not->toContain('namedless');
});

it('excludes guests and inactive users from search and honours the minimum query', function () {
    Factory::user(['fullName' => 'Suspended Person', 'suspended' => true]);
    $active = Factory::user(['fullName' => 'Active Person']);
    $mentions = Editor::getInstance()->getMentions();

    viewAs(null);
    expect($mentions->search('Person', mentionConfig()))->toBe([]);

    viewAs($active);
    $results = $mentions->search('Person', mentionConfig());
    expect(array_column($results, 'label'))->toBe(['Active Person']);
    expect($mentions->search('P', mentionConfig()))->toBe([]);
});

it('applies the mention limit after view permissions', function () {
    Factory::user(['fullName' => 'Paged Alpha']);
    Factory::user(['fullName' => 'Paged Beta']);
    $viewer = Factory::user(['fullName' => 'Paged Viewer']);
    viewAs($viewer);
    $config = mentionConfig(['criteria' => [], 'limit' => 1]);
    $config->requireViewPermission = true;

    // Without the view permission a member can only view themselves, which is past the first page.
    expect(array_column(Editor::getInstance()->getMentions()->search('Paged', $config), 'label'))->toBe(['Paged Viewer']);
});

it('orders mention search by name and then ID, unless the consumer sets an order', function () {
    $viewer = Factory::user(['fullName' => 'Viewer']);
    $ids = array_map(static fn(string $name) => (int)Factory::user(['fullName' => $name])->id, ['Stable C', 'Stable A', 'Stable B']);
    viewAs($viewer);

    $results = Editor::getInstance()->getMentions()->search('Stable', mentionConfig(['criteria' => [], 'limit' => 3]));

    expect(array_column($results, 'label'))->toBe(['Stable A', 'Stable B', 'Stable C']);
    expect(array_column($results, 'id'))->toEqualCanonicalizing($ids);

    // A consumer's own order still wins.
    $own = Editor::getInstance()->getMentions()->search('Stable', mentionConfig(['criteria' => ['orderBy' => ['users.fullName' => SORT_DESC]], 'limit' => 3]));

    expect(array_column($own, 'label'))->toBe(['Stable C', 'Stable B', 'Stable A']);
});

it('can not widen mentions to inactive users through criteria', function () {
    $suspended = Factory::user(['fullName' => 'Suspended Person', 'suspended' => true]);
    viewAs(Factory::user(['fullName' => 'Viewer']));
    $config = mentionConfig(['criteria' => ['status' => null]]);

    expect(Editor::getInstance()->getMentions()->search('Suspended', $config))->toBe([]);
    expect(Editor::getInstance()->getDocuments()->toHtml(mentionDocument($suspended->id, 'S'), $config))->toBe('<p>Hi @S</p>');
});

it('narrows mentions by criteria and an eligibility callable using the reference context', function () {
    $a = Factory::user(['fullName' => 'Scoped Alpha']);
    $b = Factory::user(['fullName' => 'Scoped Beta']);
    viewAs(Factory::user(['fullName' => 'Viewer']));
    $seen = null;
    $config = mentionConfig(['eligibleIds' => function(array $context, EditorConfig $editorConfig) use (&$seen, $a) {
        $seen = $context;

        return [$a->id];
    }]);
    $config->referenceContext = ['ownerId' => 7];
    $mentions = Editor::getInstance()->getMentions();

    expect(array_column($mentions->search('Scoped', $config), 'label'))->toBe(['Scoped Alpha']);
    expect($seen)->toBe(['ownerId' => 7]);
    expect(Editor::getInstance()->getDocuments()->toHtml(mentionDocument($b->id, 'Beta'), $config))->toBe('<p>Hi @Beta</p>');

    $byCriteria = mentionConfig(['criteria' => ['id' => $b->id]]);
    expect(array_column($mentions->search('Scoped', $byCriteria), 'label'))->toBe(['Scoped Beta']);
});

it('resolves a craft link for every viewer and links only live content', function () {
    $section = Factory::section();
    $live = Factory::entry($section, 'Live story');
    $disabled = Factory::entry($section, 'Hidden story', false);
    $documents = Editor::getInstance()->getDocuments();

    foreach ([null, Factory::user()] as $viewer) {
        viewAs($viewer);
        $html = $documents->toHtml(linkDocument($live->id), linkConfig());

        expect($html)->toContain('href="' . $live->getUrl() . '"', 'data-craft-link-id="' . $live->id . '"', '>Read this</a>');
        expect($documents->toHtml(linkDocument($disabled->id), linkConfig()))->toBe('<p>Read this</p>');
    }
});

it('scopes craft links by per-type criteria', function () {
    $news = Factory::section();
    $other = Factory::section('editorOther');
    $inScope = Factory::entry($news, 'Scoped story');
    $outOfScope = Factory::entry($other, 'Scoped elsewhere');
    viewAs(Factory::user());
    $config = linkConfig(['criteria' => [Entry::class => ['section' => $news->handle]]]);
    $documents = Editor::getInstance()->getDocuments();

    expect($documents->toHtml(linkDocument($outOfScope->id), $config))->toBe('<p>Read this</p>');
    expect($documents->toHtml(linkDocument($inScope->id), $config))->toContain('href=');
    expect($documents->toHtml(linkDocument($inScope->id, User::class), $config))->toBe('<p>Read this</p>');

    Craft::$app->getSearch()->indexElementAttributes($inScope);
    Craft::$app->getSearch()->indexElementAttributes($outOfScope);
    $results = Editor::getInstance()->getElements()->search('Scoped', $config);

    expect(array_column($results, 'id'))->toBe([(int)$inScope->id]);
    expect($results[0])->toHaveKeys(['id', 'type', 'label', 'url']);
});

it('gives guests no craft link discovery', function () {
    $entry = Factory::entry(Factory::section(), 'Findable story');
    Craft::$app->getSearch()->indexElementAttributes($entry);
    viewAs(null);

    expect(Editor::getInstance()->getElements()->search('Findable', linkConfig()))->toBe([]);
});

it('applies the search limit after eligibility', function () {
    $section = Factory::section();
    $entries = [];

    foreach (range(1, 6) as $i) {
        $entries[] = $entry = Factory::entry($section, "Limit story {$i}");
        Craft::$app->getSearch()->indexElementAttributes($entry);
    }

    viewAs(Factory::user());
    $config = linkConfig([
        'limit' => 2,
        'eligibility' => static fn(Entry $entry, EditorConfig $context): bool => !in_array($entry->title, ['Limit story 1', 'Limit story 2'], true),
    ]);
    $results = Editor::getInstance()->getElements()->search('Limit story', $config);

    expect($results)->toHaveCount(2);
    expect(array_column($results, 'label'))->not->toContain('Limit story 1', 'Limit story 2');
});

it('does not throw when craft links are on but element links are not', function () {
    $config = new EditorConfig(['handle' => 'sample.nolinks', 'features' => ['craftLink' => true]]);
    $disabled = new EditorConfig(['handle' => 'sample.offlinks', 'features' => ['craftLink' => true], 'elementLinks' => new ElementLinkConfig(['enabled' => false])]);
    $documents = Editor::getInstance()->getDocuments();

    expect($documents->toHtml(linkDocument(5), $config))->toBe('<p>Read this</p>');
    expect($documents->toHtml(linkDocument(5), $disabled))->toBe('<p>Read this</p>');
    expect(Editor::getInstance()->getElements()->resolve(['id' => 5], $config))->toBeNull();
    expect(Editor::getInstance()->getMentions()->resolve(['id' => 5], $config))->toBeNull();
    expect(Editor::getInstance()->getAssets()->resolve(['id' => 5], $config, 'inlineImage'))->toBeNull();
});

it('shows only the assets a consumer associates with the document', function () {
    $asset = savedImage();
    $document = RichText::from([['type' => 'editorAsset', 'attrs' => ['id' => $asset->id, 'alt' => 'Alt', 'src' => 'https://forged.example/x.png']]]);
    $documents = Editor::getInstance()->getDocuments();
    viewAs(null);

    expect($documents->toHtml($document, assetConfig()))->toBe('');
    expect($documents->toHtml($document, assetConfig(), associatedAssetIds: [999]))->toBe('');

    $html = $documents->toHtml($document, assetConfig(), associatedAssetIds: [$asset->id]);

    expect($html)->toContain('src="' . $asset->getUrl() . '"', 'alt="Alt"')->not->toContain('forged');
});

it('never asks a custom asset provider about unassociated ids', function () {
    $provider = new class implements verbb\editor\base\AssetResolverInterface {
        public array $asked = [];

        public function resolve(array $reference, AssetConfig $config, EditorConfig $context, verbb\editor\enums\AssetKind $kind): ?array
        {
            return null;
        }

        public function resolveAll(array $references, AssetConfig $config, EditorConfig $context): array
        {
            $this->asked = array_column($references, 'id');

            return array_map(static fn(array $reference) => ['id' => $reference['id'], 'url' => '/private/' . $reference['id'], 'filename' => 'f.pdf'], $references);
        }
    };
    $config = new EditorConfig(['handle' => 'sample.private', 'features' => ['attachment' => true], 'assets' => new AssetConfig(['enabled' => true]), 'assetProvider' => $provider]);
    $document = RichText::from([['type' => 'attachment', 'attrs' => ['id' => 1]], ['type' => 'attachment', 'attrs' => ['id' => 2]]]);

    $html = Editor::getInstance()->getDocuments()->toHtml($document, $config, associatedAssetIds: [2]);

    expect($provider->asked)->toBe([2]);
    expect($html)->toContain('/private/2')->not->toContain('/private/1');
});

it('refuses assets outside the configured volume and image references to other files', function () {
    $asset = savedImage();
    $elsewhere = Factory::volume('editorOtherVolume');
    $document = RichText::from([['type' => 'editorAsset', 'attrs' => ['id' => $asset->id]]]);

    expect(Editor::getInstance()->getDocuments()->toHtml($document, assetConfig(['volumeId' => $elsewhere->id]), associatedAssetIds: [$asset->id]))->toBe('');
});

it('prepares resolved content for editing', function () {
    $asset = savedImage();
    $attachment = RichText::from([['type' => 'attachment', 'attrs' => ['id' => $asset->id]]]);

    $resolved = Editor::getInstance()->getDocuments()->resolve($attachment, assetConfig(), [$asset->id])->getValue()[0]['attrs'];

    expect($resolved)->toMatchArray(['id' => (int)$asset->id, 'filename' => $asset->getFilename(), 'url' => $asset->getUrl()]);
    expect($resolved['mimeType'])->toBe('image/png');
});

it('drops provider urls that fail the url rules', function () {
    $provider = new class implements ElementProviderInterface {
        public function search(string $query, ElementLinkConfig $config, EditorConfig $context): array
        {
            return [];
        }

        public function resolve(array $reference, ElementLinkConfig $config, EditorConfig $context): ?array
        {
            return null;
        }

        public function resolveAll(array $references, ElementLinkConfig $config, EditorConfig $context): array
        {
            return array_map(static fn() => ['id' => 5, 'type' => Entry::class, 'label' => 'x', 'url' => 'javascript:alert(1)'], $references);
        }
    };
    $config = linkConfig();
    $config->elementProvider = $provider;

    expect(Editor::getInstance()->getDocuments()->toHtml(linkDocument(5), $config))->toBe('<p>Read this</p>');
});

it('degrades instead of throwing when a provider fails during render', function () {
    $config = mentionConfig();
    $config->mentionProvider = new class implements MentionProviderInterface {
        public function search(string $query, MentionConfig $config, EditorConfig $context): array
        {
            return [];
        }

        public function resolve(array $reference, MentionConfig $config, EditorConfig $context): ?array
        {
            return null;
        }

        public function resolveAll(array $references, MentionConfig $config, EditorConfig $context): array
        {
            throw new RuntimeException('Database is down');
        }
    };

    expect(Editor::getInstance()->getDocuments()->toHtml(mentionDocument(1, 'Stored'), $config))->toBe('<p>Hi @Stored</p>');
});

it('renders a list with one resolver call per kind', function () {
    $provider = new class implements MentionProviderInterface {
        public array $calls = [];

        public function search(string $query, MentionConfig $config, EditorConfig $context): array
        {
            return [];
        }

        public function resolve(array $reference, MentionConfig $config, EditorConfig $context): ?array
        {
            return null;
        }

        public function resolveAll(array $references, MentionConfig $config, EditorConfig $context): array
        {
            $this->calls[] = count($references);

            return array_map(static fn(array $reference) => ['id' => $reference['id'], 'type' => $reference['type'], 'label' => 'Resolved ' . $reference['id']], $references);
        }
    };
    $config = mentionConfig();
    $config->mentionProvider = $provider;
    $documents = ['a' => mentionDocument(1), 'b' => mentionDocument(2), 'c' => mentionDocument(1)];

    $rendered = Editor::getInstance()->getDocuments()->renderAll($documents, $config);

    expect($provider->calls)->toBe([2]);
    expect(array_keys($rendered))->toBe(['a', 'b', 'c']);
    expect($rendered['b'])->toContain('@Resolved 2');
});

it('keeps each document to its own asset association in a list', function () {
    $first = savedImage('first.png');
    $second = savedImage('second.png');
    $documents = [
        'a' => RichText::from([['type' => 'editorAsset', 'attrs' => ['id' => $first->id]], ['type' => 'editorAsset', 'attrs' => ['id' => $second->id]]]),
        'b' => RichText::from([['type' => 'editorAsset', 'attrs' => ['id' => $first->id]], ['type' => 'editorAsset', 'attrs' => ['id' => $second->id]]]),
    ];

    $rendered = Editor::getInstance()->getDocuments()->renderAll($documents, assetConfig(), false, ['a' => [$first->id], 'b' => [$second->id]]);

    expect($rendered['a'])->toContain('data-editor-asset-id="' . $first->id . '"')->not->toContain('data-editor-asset-id="' . $second->id . '"');
    expect($rendered['b'])->toContain('data-editor-asset-id="' . $second->id . '"')->not->toContain('data-editor-asset-id="' . $first->id . '"');
});

it('keeps list render queries flat as documents grow', function () {
    $users = array_map(static fn(int $i) => Factory::user(['fullName' => "User {$i}"]), range(1, 8));
    $documents = new Documents();
    Craft::$app->getDb()->enableProfiling = true;
    $count = static function(array $richTexts) use ($documents): int {
        $logger = Yii::getLogger();
        $logger->flush();
        $documents->renderAll($richTexts, mentionConfig());

        return $logger->getDbProfiling()[0];
    };

    $few = $count([mentionDocument($users[0]->id)]);
    $many = $count(array_map(static fn(User $user) => mentionDocument($user->id), $users));

    expect($few)->toBeGreaterThan(0);
    expect($many)->toBe($few);
});

it('renders through the twig filters with a handle', function () {
    $user = Factory::user(['fullName' => 'Pat Twig']);
    Editor::getInstance()->getEditorConfigs()->registerConfig(mentionConfig());
    $twig = new verbb\editor\web\twig\Extension();

    expect($twig->editorHtml(mentionDocument($user->id)->getValue(), 'sample.mentions'))->toContain('>@Pat Twig</span>');
    expect($twig->editorHtml(mentionDocument($user->id)->getValue(), null))->toBe('<p>Hi @Stored</p>');
    expect($twig->editorPlain(mentionDocument($user->id)->getValue(), 'sample.mentions'))->toBe('Hi @Pat Twig');
    expect($twig->editorPlain(mentionDocument($user->id)->getValue()))->toBe('Hi @Stored');
    expect(fn() => $twig->editorHtml([], 'sample.missing'))->toThrow(verbb\editor\errors\EditorConfigNotFoundException::class);
});

it('registers the bundle through the twig function without a control panel dependency', function () {
    $view = Craft::$app->getView();
    (new verbb\editor\web\twig\Extension())->editorAssets();

    expect(array_keys($view->assetBundles))->toContain(verbb\editor\web\assets\editor\EditorAsset::class);

    $bundle = $view->assetBundles[verbb\editor\web\assets\editor\EditorAsset::class];

    expect($bundle->depends)->toBe([]);
    expect($bundle->jsOptions)->toBe(['type' => 'module']);
    expect($bundle->js)->toBe(['editor.js']);
});
