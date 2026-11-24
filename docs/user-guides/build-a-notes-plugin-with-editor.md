# Build a Notes Plugin with Editor

This guide builds a small but complete Craft plugin called Notes, which lets signed-in members post notes on articles. Each note can use bold, italic, lists and links, link to another article on the site, mention another member and include photos. Visitors who aren't signed in can read every note but can't post one, and nothing a member sends to the server is trusted until your plugin has checked it.

By the end you'll have a plugin with its own database tables, a user permission, an Editor context, a controller action that saves notes and a template that shows them under each article. Every file is shown in full, in the order you'd write it, so you can follow along from an empty folder. The guide explains why each piece is there and links to the reference pages when you want the full list of options.

## What You Need

Start with a Craft 5.10 or later site running PHP 8.2 or later. The examples use [DDEV](https://ddev.com), so commands start with `ddev`. If you run Craft another way, drop that prefix and run the rest from your project root. Notes relies on user groups, so the site needs Craft Pro.

Set up these things in the control panel before you start, using the handles shown, because the plugin refers to them by handle:

- A channel section called **Articles** (`articles`), with entry URLs such as `articles/{slug}` and the template `articles/_entry`. Add two or three articles, such as “Planning the Spring Workshop” and “Volunteer Roster”.
- A volume called **Note Images** (`noteImages`) whose filesystem has public URLs, for photos posted with notes.
- A user group called **Members** (`members`), with two or three people in it who have a full name and a password.

You should be comfortable writing a little PHP and Twig. You don't need to know Editor yet, because each part is introduced as it comes up.

### A Layout and a Sign-In Page

The article template later in this guide extends a layout called `_layout.twig`, and members need a way to sign in on the front end. If your site already has both, skip ahead. Otherwise, create `templates/_layout.twig`:

```twig
<!DOCTYPE html>
<html lang="{{ currentSite.language }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ entry.title ?? siteName }}</title>
</head>
<body>
    {% block content %}{% endblock %}
</body>
</html>
```

Keep the literal `</head>` and `</body>` tags in whatever layout you use. Craft adds the CSS and JavaScript that templates register right before them, and that's how Editor's browser code reaches the page.

For signing in, set `'loginPath' => 'login'` in `config/general.php`, then create `templates/login.twig` with Craft's [front-end login form](https://craftcms.com/docs/5.x/reference/controller-actions.html#post-users-login):

```twig
{% extends '_layout' %}

{% block content %}
    <h1>Sign In</h1>

    <form method="post">
        {{ csrfInput() }}
        {{ actionInput('users/login') }}
        {{ redirectInput(craft.app.request.getQueryParam('return') ?? siteUrl) }}

        {% if errorMessage is defined %}
            <p>{{ errorMessage }}</p>
        {% endif %}

        <p><label>Username or email<br><input type="text" name="loginName" autocomplete="username"></label></p>
        <p><label>Password<br><input type="password" name="password" autocomplete="current-password"></label></p>
        <p><button type="submit">Sign in</button></p>
    </form>
{% endblock %}
```

## How the Pieces Fit Together

Editor isn't a plugin you install in the control panel. It's a Composer package that your plugin requires and then starts up. It brings the editor itself, a `<verbb-editor>` element that people write in, and the endpoints that element calls while someone writes, for looking up people to mention, searching for pages to link to and uploading photos. On the server, its PHP services clean up what the browser sends and turn saved documents into HTML.

What Editor doesn't do is decide anything about your content. Notes decides who may post, where notes are stored, which photos belong to which note and who can be mentioned. Editor asks your plugin each of those questions through a **context**, which is a named bundle of trusted settings that your plugin registers on every request. The browser only ever sends a context's name, such as `notes.note`, and the name grants nothing by itself, because every request is checked against what you registered.

A saved note is a JSON document holding the text, its formatting and **references**. A mention is stored as a user's ID and name, a page link as an entry's ID and title, and a photo as an Asset's ID and its alt text. None of those store a URL, so a moved page or a renamed file still works, and nobody can slip a forged address into a mention, page link or photo. Only an ordinary link to an address the member typed keeps that address.

## Create the Plugin Package

Craft plugins are Composer packages, so start with a `plugins/notes` folder in your project and add a `composer.json` to it. The `require` section lists Editor, which means anyone who installs Notes gets Editor too, and site owners never install it separately.

```json
{
    "name": "acme/craft-notes",
    "description": "Members post notes on entries.",
    "type": "craft-plugin",
    "license": "MIT",
    "require": {
        "php": "^8.2",
        "craftcms/cms": "^5.10.0",
        "verbb/editor": "^1.0.0"
    },
    "autoload": {
        "psr-4": {
            "acme\\notes\\": "src/"
        }
    },
    "extra": {
        "handle": "notes",
        "name": "Notes",
        "developer": "Acme",
        "class": "acme\\notes\\Notes"
    }
}
```

The `extra` section is what makes this a Craft plugin. It gives Craft the plugin's handle, its name and the class that runs it.

While you're developing the plugin, tell your project where to find it with a path repository, then require it. Run these from your project root:

```shell
ddev composer config repositories.notes '{"type":"path","url":"plugins/notes","options":{"symlink":true}}'
ddev composer require acme/craft-notes
```

Composer links `vendor/acme/craft-notes` to your `plugins/notes` folder, so your edits take effect straight away, and it installs Editor alongside. Don't install the plugin in Craft yet, because it has no code. You'll do that once the files below are in place.

## Write the Plugin Class

Create `plugins/notes/src/Notes.php`. This is the class named in `composer.json`, and Craft runs its `init()` on every request.

```php
<?php
namespace acme\notes;

use acme\notes\models\Settings;
use acme\notes\services\Notes as NotesService;
use acme\notes\variables\NotesVariable;

use Craft;
use craft\base\Model;
use craft\base\Plugin;
use craft\events\RegisterTemplateRootsEvent;
use craft\events\RegisterUserPermissionsEvent;
use craft\services\UserPermissions;
use craft\web\twig\variables\CraftVariable;
use craft\web\View;

use verbb\editor\Editor;

use yii\base\Event;

/**
 * @method Settings getSettings()
 */
class Notes extends Plugin
{
    public const PERMISSION_POST = 'notes-postNotes';

    public static function config(): array
    {
        return [
            'components' => [
                'notes' => NotesService::class,
            ],
        ];
    }

    public function init(): void
    {
        parent::init();

        // Editor's endpoints and garbage collection have to exist on every request.
        Editor::bootstrap();

        // The context looks up a volume, so wait until Craft has finished loading.
        Craft::$app->onInit(function() {
            $this->getNotes()->registerEditorContext();
        });

        Event::on(UserPermissions::class, UserPermissions::EVENT_REGISTER_PERMISSIONS, function(RegisterUserPermissionsEvent $event) {
            $event->permissions[] = [
                'heading' => Craft::t('notes', 'Notes'),
                'permissions' => [
                    self::PERMISSION_POST => ['label' => Craft::t('notes', 'Post notes on entries')],
                ],
            ];
        });

        Event::on(View::class, View::EVENT_REGISTER_SITE_TEMPLATE_ROOTS, function(RegisterTemplateRootsEvent $event) {
            $event->roots['notes'] = __DIR__ . '/templates';
        });

        Event::on(CraftVariable::class, CraftVariable::EVENT_INIT, function(Event $event) {
            $event->sender->set('notes', NotesVariable::class);
        });
    }

    public function getNotes(): NotesService
    {
        return $this->get('notes');
    }

    protected function createSettingsModel(): ?Model
    {
        return new Settings();
    }
}
```

`Editor::bootstrap()` is the line that starts Editor. It registers Editor's endpoints, its Twig filters and its garbage collection, so it has to run on every request, including the requests the editor makes in the background. If two plugins on a site both use Editor, both call `bootstrap()` and Editor starts once.

Registering the context waits for `Craft::$app->onInit()`, because the context looks up the Note Images volume, and Craft hasn't finished loading its project config while plugins are still initialising.

The rest of `init()` is ordinary Craft plugin work. The permission event adds **Post notes on entries** to the user group permissions screen. The template roots event lets your site templates include the plugin's templates as `notes/...`, and the variable event makes `craft.notes` available in Twig.

## Add Settings

The plugin needs to know which section takes notes and which volume keeps their photos. Rather than fixing those in code, give the plugin a settings model in `plugins/notes/src/models/Settings.php`:

```php
<?php
namespace acme\notes\models;

use craft\base\Model;

class Settings extends Model
{
    // The section whose entries take notes.
    public string $section = 'articles';

    // The volume that keeps images posted with notes.
    public string $volume = 'noteImages';
}
```

A site that uses different handles can override them in a `config/notes.php` file, which returns an array such as `['section' => 'news']`. This guide keeps the defaults.

## Store Notes in Your Own Tables

Editor has no tables of its own, so each note lives in a table that Notes creates. Notes also needs a second table that records which Assets belong to which note.

That second table matters because of how Editor renders photos. A note's JSON names its photos by Asset ID, and when Editor renders a note it only shows the IDs your plugin says belong to it. Without that rule, anyone could type another person's Asset ID into a note and have it appear. Your plugin is the only thing that knows which photos were posted with which note, so it keeps that list.

Create the record class in `plugins/notes/src/records/Note.php`:

```php
<?php
namespace acme\notes\records;

use craft\db\ActiveRecord;

/**
 * @property int $id
 * @property int $entryId
 * @property int $userId
 * @property string $body
 */
class Note extends ActiveRecord
{
    public static function tableName(): string
    {
        return '{{%notes}}';
    }
}
```

Then create the install migration in `plugins/notes/src/migrations/Install.php`. Craft runs it when the plugin is installed and reverses it with `safeDown()` when it's uninstalled.

```php
<?php
namespace acme\notes\migrations;

use craft\db\Migration;
use craft\db\Table;

class Install extends Migration
{
    public function safeUp(): bool
    {
        $this->createTable('{{%notes}}', [
            'id' => $this->primaryKey(),
            'entryId' => $this->integer()->notNull(),
            'userId' => $this->integer()->notNull(),
            'body' => $this->mediumText()->notNull(),
            'dateCreated' => $this->dateTime()->notNull(),
            'dateUpdated' => $this->dateTime()->notNull(),
            'uid' => $this->uid(),
        ]);

        // Which Assets each note may show. Editor only renders images listed here.
        $this->createTable('{{%notes_assets}}', [
            'id' => $this->primaryKey(),
            'noteId' => $this->integer()->notNull(),
            'assetId' => $this->integer()->notNull(),
            'dateCreated' => $this->dateTime()->notNull(),
            'dateUpdated' => $this->dateTime()->notNull(),
            'uid' => $this->uid(),
        ]);

        $this->createIndex(null, '{{%notes}}', ['entryId', 'dateCreated']);
        $this->createIndex(null, '{{%notes_assets}}', ['noteId', 'assetId'], true);

        $this->addForeignKey(null, '{{%notes}}', ['entryId'], Table::ELEMENTS, ['id'], 'CASCADE');
        $this->addForeignKey(null, '{{%notes}}', ['userId'], Table::USERS, ['id'], 'CASCADE');
        $this->addForeignKey(null, '{{%notes_assets}}', ['noteId'], '{{%notes}}', ['id'], 'CASCADE');
        $this->addForeignKey(null, '{{%notes_assets}}', ['assetId'], Table::ASSETS, ['id'], 'CASCADE');

        return true;
    }

    public function safeDown(): bool
    {
        $this->dropTableIfExists('{{%notes_assets}}');
        $this->dropTableIfExists('{{%notes}}');

        return true;
    }
}
```

The `body` column is a `mediumText`, because a document's JSON is larger than its visible text, and Editor's default size limit is 512 KB. The foreign keys tidy the tables up for you. Craft first moves a deleted entry or user to the trash, and once it's permanently deleted, their notes go with it. Deleting a note deletes its rows in `notes_assets`, and deleting an Asset removes it from any note that showed it.

## Write the Notes Service

The service is where the plugin's real work happens. Create `plugins/notes/src/services/Notes.php`:

```php
<?php
namespace acme\notes\services;

use acme\notes\Notes as NotesPlugin;
use acme\notes\records\Note;

use Craft;
use craft\base\Component;
use craft\db\Query;
use craft\elements\Entry;
use craft\elements\User;
use craft\helpers\DateTimeHelper;
use craft\helpers\Db;
use craft\helpers\Template;

use verbb\editor\Editor;
use verbb\editor\RichText;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\ElementLinkConfig;
use verbb\editor\models\MentionConfig;

use yii\base\UserException;

use Throwable;

class Notes extends Component
{
    public const CONTEXT = 'notes.note';
    public const MAX_LENGTH = 2000;

    public function registerEditorContext(): void
    {
        $settings = NotesPlugin::getInstance()->getSettings();
        $volume = Craft::$app->getVolumes()->getVolumeByHandle($settings->volume);

        Editor::$plugin->getEditorConfigs()->registerConfig(new EditorConfig([
            'handle' => self::CONTEXT,
            'placeholder' => Craft::t('notes', 'Add a note…'),
            'features' => [
                'bold' => true,
                'italic' => true,
                'lists' => true,
                'link' => true,
                'craftLink' => true,
                'mention' => true,
                'image' => true,
            ],
            'mentions' => new MentionConfig([
                'enabled' => true,
                'criteria' => ['group' => 'members'],
            ]),
            'elementLinks' => new ElementLinkConfig([
                'enabled' => true,
                'elementTypes' => [Entry::class],
                'criteria' => [Entry::class => ['section' => $settings->section]],
            ]),
            'assets' => new AssetConfig([
                'enabled' => $volume !== null,
                'volumeId' => $volume?->id,
                'maxImages' => 4,
            ]),
            'authorize' => fn(User $user) => $user->can(NotesPlugin::PERMISSION_POST),
            'resolveScope' => function(array $scope): ?array {
                $entry = $this->getEntryForNotes((int)($scope['entryId'] ?? 0));

                return $entry ? ['entry' => $entry] : null;
            },
        ]));
    }

    public function getEditorConfig(): EditorConfig
    {
        return Editor::$plugin->getEditorConfigs()->requireConfigByHandle(self::CONTEXT);
    }

    /**
     * Notes belong to live entries in the plugin's section, and nowhere else.
     */
    public function getEntryForNotes(int $entryId): ?Entry
    {
        if ($entryId < 1) {
            return null;
        }

        return Entry::find()
            ->id($entryId)
            ->section(NotesPlugin::getInstance()->getSettings()->section)
            ->one();
    }

    public function getNotesForEntry(Entry $entry): array
    {
        $rows = (new Query())
            ->select(['id', 'userId', 'body', 'dateCreated'])
            ->from('{{%notes}}')
            ->where(['entryId' => $entry->id])
            ->orderBy(['dateCreated' => SORT_ASC, 'id' => SORT_ASC])
            ->all();

        if (!$rows) {
            return [];
        }

        $noteIds = array_column($rows, 'id');
        $assetIds = [];

        foreach ((new Query())->select(['noteId', 'assetId'])->from('{{%notes_assets}}')->where(['noteId' => $noteIds])->all() as $row) {
            $assetIds[$row['noteId']][] = (int)$row['assetId'];
        }

        $documents = [];
        $associated = [];

        foreach ($rows as $row) {
            $documents[$row['id']] = RichText::from($row['body']);
            $associated[$row['id']] = $assetIds[$row['id']] ?? [];
        }

        // One lookup per kind of reference for the whole list, rather than per note.
        $html = Editor::$plugin->getDocuments()->renderAll($documents, $this->getEditorConfig(), associatedAssetIds: $associated);

        $authors = User::find()
            ->id(array_unique(array_column($rows, 'userId')))
            ->status(null)
            ->indexBy('id')
            ->all();

        return array_map(fn(array $row) => [
            'id' => (int)$row['id'],
            'author' => $authors[$row['userId']] ?? null,
            'dateCreated' => DateTimeHelper::toDateTime($row['dateCreated']),
            'html' => Template::raw($html[$row['id']]),
        ], $rows);
    }

    /**
     * Throws a `UserException`, such as Editor's `DocumentLimitException`, whose message is safe
     * to show the author.
     */
    public function saveNote(Entry $entry, User $author, mixed $body): Note
    {
        $config = $this->getEditorConfig();
        $documents = Editor::$plugin->getDocuments();

        // The save boundary: limits, the context's features and sanitising.
        $richText = $documents->normalize($body, $config);

        if ($richText->isEmpty()) {
            throw new UserException(Craft::t('notes', 'Write something before posting.'));
        }

        if ($richText->getTextLength() > self::MAX_LENGTH) {
            throw new UserException(Craft::t('notes', 'Notes can be up to {max} characters.', ['max' => self::MAX_LENGTH]));
        }

        $imageIds = [];

        foreach ($richText->extractReferences() as $reference) {
            if ($reference->nodeType === 'editorAsset' && $reference->referenceId()) {
                $imageIds[] = (int)$reference->referenceId();
            }
        }

        // Moves the author's temporary uploads into the notes volume and refuses anything that
        // isn't theirs. Moving files can't be rolled back, so this happens before the note is saved.
        Editor::$plugin->getAssets()->finalize(
            array_map(fn(int $id) => ['id' => $id, 'kind' => 'inlineImage'], $imageIds),
            $config,
            $author->id,
        );

        $transaction = Craft::$app->getDb()->beginTransaction();

        try {
            $note = new Note();
            $note->entryId = $entry->id;
            $note->userId = $author->id;
            $note->body = $richText->toJson();
            $note->save(false);

            foreach ($imageIds as $assetId) {
                Db::insert('{{%notes_assets}}', ['noteId' => $note->id, 'assetId' => $assetId]);
            }

            $transaction->commit();
        } catch (Throwable $e) {
            $transaction->rollBack();

            throw $e;
        }

        return $note;
    }
}
```

This file does three jobs, which the next sections walk through.

### The Editor Context

`registerEditorContext()` describes the editor that Notes offers, and every setting in it is trusted, because it's your code running on the server.

`features` turns on bold, italic, lists, ordinary links, links to Craft pages (`craftLink`), mentions and images. Everything else, such as headings and attachments, stays off. Mentions, images and page links also need their own settings to work, and each one narrows what's allowed:

- `MentionConfig` with `criteria` of `['group' => 'members']` means only members can be suggested or mentioned. The criteria are applied to a Craft user query, so anything a user query accepts works here.
- `ElementLinkConfig` allows links to entries in the Articles section and nowhere else.
- `AssetConfig` sends uploads to the Note Images volume and allows up to four images per note. Without a volume, uploads are turned off rather than failing.

`resolveScope` and `authorize` both run before any of Editor's endpoints does anything. `resolveScope` checks what a request is about. When the template puts the editor on an article, it tells the browser that article's ID. The browser sends that ID back with every request, and `resolveScope` checks it's a real, live article. Returning `null` refuses the request, so someone can't take a valid page and point its requests at an entry that doesn't take notes. `authorize` then checks who is asking, so only people with the **Post notes on entries** permission can search for people, search for pages or upload a photo.

See [Context Settings](../developers/context-settings.md) for every context setting.

### Saving a Note

`saveNote()` is the save boundary, the point where untrusted JSON from the browser becomes a note.

`normalize()` comes first. It checks the document against the context's size limits, removes anything the context doesn't allow, and strips each mention, page link and photo back to its reference. If a document is too large or holds too many images, it throws a `DocumentLimitException`, whose message is safe to show the member. The service then checks that the note isn't empty and that its text is no longer than 2,000 characters. The editor's `limit` warns the member in the browser, but the server checks again, because a browser can be bypassed. `getTextLength()` counts exactly as the editor's counter does, so a note the counter accepts is never refused for its length.

Photos need one more step. When a member adds a photo, Editor uploads it straight away as a temporary Asset that only they own, and it isn't in Note Images yet. `finalize()` moves the member's temporary uploads into the volume. It refuses any Asset that isn't one of their own uploads, which stops a member attaching a photo from someone else's note. It checks every photo before it moves any, so if it refuses one, nothing moves and no note is saved. It runs before the database transaction, because moving a file isn't something a transaction can undo. Saving the note and recording its photos then happen together in one transaction.

### Rendering Notes

`getNotesForEntry()` loads an article's notes and their photo IDs, then hands them all to `renderAll()`. Rendering turns each reference back into something readable. A mention shows the member's current name, a page link gets the article's current URL, and a photo becomes an `<img>` with its URL and alt text.

`renderAll()` looks up every mentioned person, linked page and photo across the whole list at once, so a page with fifty notes makes the same few queries as a page with one. Rendering doesn't depend on who's viewing, so guests see exactly what members see. If a mentioned member leaves the Members group, their mention shows as plain text, and a link to an article that's been deleted keeps its words without the link.

## Add the Save Action

Members post notes through a controller action. Create `plugins/notes/src/controllers/NotesController.php`:

```php
<?php
namespace acme\notes\controllers;

use acme\notes\Notes;

use Craft;
use craft\web\Controller;

use yii\base\UserException;
use yii\web\NotFoundHttpException;
use yii\web\Response;

class NotesController extends Controller
{
    public function actionSave(): ?Response
    {
        $this->requirePostRequest();
        $this->requirePermission(Notes::PERMISSION_POST);

        $notes = Notes::getInstance()->getNotes();
        $entry = $notes->getEntryForNotes((int)$this->request->getRequiredBodyParam('entryId'));

        if (!$entry) {
            throw new NotFoundHttpException('Entry not found.');
        }

        $body = $this->request->getBodyParam('body');

        try {
            $notes->saveNote($entry, static::currentUser(), $body);
        } catch (UserException $e) {
            // Back to the entry, with the note still in the editor.
            return $this->asFailure($e->getMessage(), routeParams: ['noteBody' => $body]);
        }

        return $this->asSuccess(Craft::t('notes', 'Note posted.'));
    }
}
```

`requirePermission()` checks the same permission that `authorize` checks, because the save action is a separate request from the editor's endpoints and needs its own check. A guest's request is refused with a 403, and Craft checks the form's CSRF token automatically. The action also looks the entry up through `getEntryForNotes()`, so a note can't be posted on an entry outside the Articles section.

When the service refuses a note, `asFailure()` shows the message and sends the submitted JSON back to the template as `noteBody`, so the member's text is still in the editor and they can fix it. On success, Craft redirects to the address in the form's `redirect` field.

## Add a Template Variable

Templates need the notes to show and the options for the editor, and a template variable provides both. Create `plugins/notes/src/variables/NotesVariable.php`:

```php
<?php
namespace acme\notes\variables;

use acme\notes\Notes;

use craft\elements\Entry;

class NotesVariable
{
    public function getNotes(Entry $entry): array
    {
        return Notes::getInstance()->getNotes()->getNotesForEntry($entry);
    }

    /**
     * Holds the viewer's CSRF token, so never cache the page it's on in a shared cache.
     */
    public function editorOptions(Entry $entry): array
    {
        return Notes::getInstance()->getNotes()->getEditorConfig()->browserOptions(['entryId' => $entry->id]);
    }
}
```

`browserOptions()` produces everything the editor needs for this context, so you never repeat it by hand. That includes the enabled features, translated interface text, the endpoint URLs and the signed-in member's CSRF token. The array passed to it becomes the scope that `resolveScope` checks.

Because those options include a CSRF token for the person viewing, a page that shows the editor must never be stored in a cache that other visitors share, such as Craft's `{% cache %}` tag or a full-page cache.

## Write the Notes Template

Create `plugins/notes/src/templates/_notes.twig`. It shows the notes and, for members who may post, the form to add one.

```twig
{# Include on an entry page with {% include 'notes/_notes' with { entry } %} #}
{% do editorAssets() %}

<section id="notes" class="notes">
    <h2>{{ 'Notes'|t('notes') }}</h2>

    {% for note in craft.notes.getNotes(entry) %}
        <article class="note" id="note-{{ note.id }}">
            <p class="note-meta">
                <strong>{{ note.author.friendlyName ?? 'Former member'|t('notes') }}</strong>
                <time datetime="{{ note.dateCreated|atom }}">{{ note.dateCreated|date('short') }}</time>
            </p>

            <div class="note-body">{{ note.html }}</div>
        </article>
    {% else %}
        <p>{{ 'No notes yet.'|t('notes') }}</p>
    {% endfor %}

    {% if currentUser and currentUser.can('notes-postNotes') %}
        {% set options = craft.notes.editorOptions(entry) %}

        {# After a refused post, put the note back in the editor. #}
        {% if noteBody is defined %}
            {% set options = options|merge({ content: noteBody }) %}
        {% endif %}

        {% set error = craft.app.session.getFlash('error') %}
        {% set notice = craft.app.session.getFlash('success') %}

        <form method="post" class="note-form">
            {{ csrfInput() }}
            {{ actionInput('notes/notes/save') }}
            {{ redirectInput(entry.url ~ '#notes') }}
            {{ hiddenInput('entryId', entry.id) }}

            {% if error %}
                <p class="note-error" role="alert">{{ error }}</p>
            {% elseif notice %}
                <p class="note-notice" role="status">{{ notice }}</p>
            {% endif %}

            <verbb-editor name="body" required aria-label="{{ 'Add a note'|t('notes') }}"
                submit-label="{{ 'Post'|t('notes') }}" limit="2000"
                draft-key="note:{{ currentUser.id }}:{{ entry.id }}"
                data-options="{{ options|json_encode }}">
                <span slot="header">{{ 'Posting as'|t('notes') }} <b>{{ currentUser.friendlyName }}</b></span>
            </verbb-editor>
        </form>
    {% elseif not currentUser %}
        <p><a href="{{ siteUrl('login') }}">{{ 'Sign in to post a note.'|t('notes') }}</a></p>
    {% endif %}
</section>
```

`editorAssets()` registers Editor's browser bundle, which defines the `<verbb-editor>` element. The bundle ships inside Editor's Composer package, so there's nothing to build with npm.

The `<verbb-editor>` element behaves like a form field. Its `name` is `body`, so the form submits the document's JSON as `body`, and `required` stops it posting while it's empty. `submit-label` adds Editor's own Post button, and members can also post with ⌘↵ or Ctrl+Enter. `limit` shows a countdown near 2,000 characters and holds Post once a note is over. `draft-key` keeps an unfinished note in the member's browser until it's posted, and the key includes both the member and the article, so drafts never cross between them. `data-options` takes the options from `craft.notes.editorOptions()`.

The form itself is ordinary Craft. `actionInput()` sends it to the save action, `redirectInput()` brings the member back to the notes once they've posted, and `entryId` names the article. The two flash messages show the save action's error or its “Note posted.” confirmation. Reading the confirmation here matters, because a flash message nobody reads stays in the session and turns up on the next page that does. Each note's HTML comes from the service, already rendered and safe to output.

See [Element Attributes](../reference/editor-options.md#element-attributes) for its other attributes, and [Posting](../feature-tour/posting.md) to post with your own JavaScript instead of a form submission.

## Install the Plugin and Give Members Permission

With every file in place, install the plugin. Craft runs the install migration and creates both tables.

```shell
ddev craft plugin/install notes
```

Now open **Settings → Users → User Groups → Members** in the control panel. Under **Notes**, tick **Post notes on entries** and save. If you skip this step, members see the notes but no editor, because the template only shows it to people with the permission.

## Show Notes on Articles

Finally, include the plugin's template in your article template, `templates/articles/_entry.twig`. It extends the `_layout.twig` from [A Layout and a Sign-In Page](#a-layout-and-a-sign-in-page). Yours can extend whatever layout your site uses.

```twig
{% extends '_layout' %}

{% block content %}
    <h1>{{ entry.title }}</h1>

    {% include 'notes/_notes' with { entry } %}
{% endblock %}
```

Passing `entry` hands the template the article being viewed, which is the article each note is posted on.

## Post Your First Note

Sign in on the front end as a member and open an article. Under **Notes** you'll see “No notes yet.” and the editor, with “Posting as” and the member's name above it and the tools beneath it.

Write a short note that tries each feature:

1. Type “Draft agenda and timings”.
2. Select “agenda” and press ⌘B or Ctrl+B to make it bold, then select “timings” and press ⌘I or Ctrl+I to make it italic.
3. Press Enter at the end of the line and type `- ` (a hyphen and a space) to start a bulleted list.
4. Type `@` and the first letters of another member's name, such as `@Sam`, and choose them from the list.
5. Press Enter for a second item and type “Check the roster”. Select “roster”, press ⌘K or Ctrl+K, type “Volunteer” and choose **Volunteer Roster** from the pages on this site.
6. Press Enter for a third item and type “Venue map”. Select it, press ⌘K or Ctrl+K, type the address `example.com/venue-map` and press Enter.
7. Add a photo with the **Add photos** button, or drop one on the editor. It uploads straight away and appears in the tray under the text.
8. Choose **ALT** on the photo, describe it, such as “Room layout for the workshop”, and press Enter.
9. Choose **Post**.

The page reloads at the notes, with “Note posted.” above the editor. The new note shows the member's name and the date, then the bold and italic text, a bulleted list with the mention as “@Sam Rivera”, links to the Volunteer Roster article and the venue map, and the photo. The editor is empty again and its draft is gone. Reload the page and the note looks the same, because it's rendered from what was saved.

If the photo doesn't appear, check that the Note Images volume's filesystem has public URLs and that its handle matches the plugin's `volume` setting.

Behind the scenes, the `notes` table now has a row whose `body` holds the document's JSON. It stores the mention as Sam's user ID and name, the page link as the article's ID and title, and the photo as its Asset ID and alt text, with no URLs for any of them. Only the ordinary link keeps its address. The photo has moved from the member's temporary uploads into Note Images, and `notes_assets` has a row linking it to the note.

## What Guests See

Sign out, or open the article in a private window. The notes look exactly as they did for the member, with the same mention, links and photo, because rendering never depends on the viewer. Instead of the editor, guests see a link to sign in and post a note.

Guests never see the editor in Notes, because only members with the permission can post. If your own plugin does let guests write, such as guest comments, `browserOptions()` handles it for you. For a visitor who isn't signed in, it keeps the basic formatting and ordinary links and turns off mentions, page links and uploads, and Editor's endpoints refuse guests whatever the browser sends. Your save action still has to decide whether guests may post at all and what happens to their content.

## Check What Your Plugin Refuses

The checks you've written keep members inside the rules. You can see one refuse a note from your browser's developer tools. Find the hidden `entryId` field in the notes form, change its value to the ID of an entry in another section, write a note and post it. The save action can't find that entry among the articles, so it answers with a 404 and nothing is saved.

Editor's endpoints only answer for the article the editor is on. A mention search, page search or upload whose scope names an entry outside Articles is refused with a 403 and “You can’t use this editor here.”, because `resolveScope` returns `null`. The same happens to a request with no scope at all. Searches only offer what the context allows, so page search never suggests an entry from another section, and someone outside Members is never suggested as a mention.

The save action refuses a note for an entry outside Articles with a 404, and refuses guests with a 403. If a member submits a note that names a photo from someone else's note, `finalize()` refuses it with “An uploaded asset can’t be used here.”, nothing is saved, and the member's text is put back in the editor for them to fix.

## What Your Plugin Owns

Editor handles the writing, the uploads and the rendering, and the rest is your plugin's responsibility. Most of it is already in the code above, but a few parts are worth knowing about as Notes grows.

Deleting a note removes its rows from `notes_assets` but leaves its photos in Note Images. Editor never deletes an Asset when a reference disappears, because it can't know whether something else still uses it. If you add a way to delete notes, delete their photos too, or clean up Assets that no note shows. A member can also reuse one of their own posted photos in another note, since it's already theirs, so check `notes_assets` before deleting a photo. Uploads that were never posted are different, and Craft's garbage collection removes them after 24 hours without your plugin doing anything.

Mentions don't notify anyone by themselves. To email or notify mentioned members, read who was mentioned with `extractMentions()` after a note saves and send your own notifications. See [Mentions](../developers/craft-integration.md#mentions) for the details.

To let members edit a note later, load it with `Documents::resolve()` and pass that as the editor's `content`, so its photos can display, and pass the note's own photo IDs to `finalize()` so they're allowed through. The [site module guide](add-editor-to-a-site-module.md) shows editing in full, along with what changes when there's no plugin to hold your code.
