# Add Editor to a Site Module

Editor doesn't need a plugin around it. Any code that requires it and starts it on every request can use it, and that includes a site module, the PHP code that lives in your own Craft project rather than in a package you'd publish. This guide adds front-end rich-text editing to a single site with a module, and it's the right approach when the feature belongs to that one site and nowhere else.

The example is a site with a Projects section. Each project page shows a “Latest Update”, and members of the project team can rewrite it from the front end, using bold, italic, lists and links, linking to another project, mentioning a teammate and adding photos. Visitors and other members read the update but don't get an editor, and the module checks everything the browser sends before saving it into a Plain Text field on the project's entry.

By the end you'll have a module with a custom permission, an Editor context, a controller action that saves to the entry and a project template that shows and edits the update. A module has to take care of a few things a plugin would handle with its own tables, and the guide points those out as they come up.

## What You Need

Start with a Craft 5.10 or later site running PHP 8.2 or later, on Craft Pro, since the example uses user groups. The examples use [DDEV](https://ddev.com), so commands start with `ddev`. If you run Craft another way, drop that prefix and run the rest from your project root.

Set up these things in the control panel first, using the handles shown, because the module refers to them by handle:

- A volume called **Project Images** (`projectImages`) whose filesystem has public URLs.
- A Plain Text field called **Status Update** (`statusUpdate`). Turning **Allow line breaks** on gives it a larger box in the control panel, which makes the stored JSON easier to read.
- An Assets field called **Status Images** (`statusImages`), limited to the Project Images volume.
- A channel section called **Projects** (`projects`), with entry URLs such as `projects/{slug}` and the template `projects/_entry`, and with both fields in its entry type's field layout. Add two projects, such as “Community Garden” and “Library Renovation”.
- A user group called **Project Team** (`projectTeam`) with two members in it, and another member who isn't on the team, so you can see the difference.
- A layout template, `templates/_layout.twig`, with a `content` block and literal `</head>` and `</body>` tags, because Craft adds Editor's CSS and JavaScript right before them.
- A front-end sign-in page, with Craft's `loginPath` set to `'login'` in `config/general.php` and a `templates/login.twig` holding Craft's [front-end login form](https://craftcms.com/docs/5.x/reference/controller-actions.html#post-users-login).

The [plugin guide](build-a-notes-plugin-with-editor.md#a-layout-and-a-sign-in-page) shows a minimal layout and sign-in page you can copy if your site doesn't have them yet.

You should be comfortable with a little PHP and Twig. If you haven't written a module before, Craft's [module documentation](https://craftcms.com/docs/5.x/extend/module-guide.html) explains the idea, and this guide shows every file you need.

## What a Module Has to Own

Editor gives you the editor, its endpoints for mentions, page links and uploads, and the PHP that cleans up and renders documents. Everything else belongs to whoever uses it, and with a module that's you. That covers three areas.

### Storage

Editor has no field type and no tables, so there's no Editor field to add to an entry. The document is JSON, and a Plain Text field holds it well, as long as only your module writes to it. Photos need somewhere to live too. Editor only renders the Asset IDs you say belong to a document, so nobody can drop another file's ID into the JSON and have it appear. A plugin would keep that list in its own table, and here the Status Images field keeps it, which also gives each photo an ordinary Craft relation to the entry.

### Permissions

A module has no plugin permissions screen of its own, but it can still register a permission through Craft's permissions event, which you then tick for a user group in the control panel. A user group check would also work, although a permission lets you change who can edit without touching code.

### Cleanup

When someone removes a photo from an update, the module takes it out of the Status Images field, but the Asset stays in the volume. Editor never deletes Assets, because it can't know whether anything else still uses them. Uploads that were never saved are different, and Craft's garbage collection removes them after 24 hours.

## Require Editor

Run this from your project root:

```shell
ddev composer require verbb/editor
```

Editor is a Composer package rather than a Craft plugin, so there's nothing to install or enable in the control panel afterwards. It does nothing until your module starts it.

## Autoload the Module

Modules live in your project, so Composer needs to know where to find their classes. Add an `autoload` section to your project's `composer.json`:

```json
"autoload": {
    "psr-4": {
        "modules\\": "modules/"
    }
}
```

Then regenerate Composer's autoloader:

```shell
ddev composer dump-autoload
```

## Write the Module Class

Create `modules/projectupdates/Module.php`. Craft runs its `init()` on every request once it's registered in the next step.

```php
<?php
namespace modules\projectupdates;

use modules\projectupdates\variables\ProjectUpdatesVariable;

use Craft;
use craft\elements\Entry;
use craft\elements\User;
use craft\events\RegisterUserPermissionsEvent;
use craft\services\UserPermissions;
use craft\web\twig\variables\CraftVariable;

use verbb\editor\Editor;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\ElementLinkConfig;
use verbb\editor\models\MentionConfig;

use yii\base\Event;

class Module extends \yii\base\Module
{
    public const CONTEXT = 'site.project-update';
    public const PERMISSION = 'site-editProjectUpdates';

    public static function getProjectEntry(int $entryId): ?Entry
    {
        if ($entryId < 1) {
            return null;
        }

        return Entry::find()->id($entryId)->section('projects')->one();
    }

    public function init(): void
    {
        Craft::setAlias('@modules/projectupdates', __DIR__);

        // Web controllers live in controllers/, and this module has no console commands.
        if (!Craft::$app->getRequest()->getIsConsoleRequest()) {
            $this->controllerNamespace = 'modules\\projectupdates\\controllers';
        }

        parent::init();

        // Editor's endpoints and garbage collection have to exist on every request.
        Editor::bootstrap();

        // The context looks up a volume, so wait until Craft has finished loading.
        Craft::$app->onInit(function() {
            $this->_registerEditorContext();
        });

        Event::on(UserPermissions::class, UserPermissions::EVENT_REGISTER_PERMISSIONS, function(RegisterUserPermissionsEvent $event) {
            $event->permissions[] = [
                'heading' => 'Project Updates',
                'permissions' => [
                    self::PERMISSION => ['label' => 'Edit project updates on the front end'],
                ],
            ];
        });

        Event::on(CraftVariable::class, CraftVariable::EVENT_INIT, function(Event $event) {
            $event->sender->set('projectUpdates', ProjectUpdatesVariable::class);
        });
    }

    private function _registerEditorContext(): void
    {
        $volume = Craft::$app->getVolumes()->getVolumeByHandle('projectImages');

        Editor::$plugin->getEditorConfigs()->registerConfig(new EditorConfig([
            'handle' => self::CONTEXT,
            'placeholder' => 'What’s new with this project?',
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
                'criteria' => ['group' => 'projectTeam'],
            ]),
            'elementLinks' => new ElementLinkConfig([
                'enabled' => true,
                'elementTypes' => [Entry::class],
                'criteria' => [Entry::class => ['section' => 'projects']],
            ]),
            'assets' => new AssetConfig([
                'enabled' => $volume !== null,
                'volumeId' => $volume?->id,
                'maxImages' => 4,
            ]),
            'authorize' => fn(User $user) => $user->can(self::PERMISSION),
            'resolveScope' => function(array $scope): ?array {
                $entry = self::getProjectEntry((int)($scope['entryId'] ?? 0));

                return $entry ? ['entry' => $entry] : null;
            },
        ]));
    }
}
```

`Editor::bootstrap()` is the line that starts Editor. It registers Editor's endpoints, its Twig filters and its garbage collection, so it has to run on every request, including the requests the editor makes in the background. This is the one place where a module and a plugin do exactly the same thing. If a plugin on the site also uses Editor, both call `bootstrap()` and Editor starts once.

The context is registered inside `Craft::$app->onInit()`, because it looks up the Project Images volume, and Craft hasn't finished loading its project config while modules are still initialising.

The permission event adds a **Project Updates** heading to each user group's permissions with one permission under it, **Edit project updates on the front end**. Its key, `site-editProjectUpdates`, is what the module checks. The variable event makes `craft.projectUpdates` available in Twig, which the template uses for the editor's options.

`getProjectEntry()` is the module's one rule about where updates can go. It returns a live entry in the Projects section, or `null`, and both the context and the save action use it.

### The Editor Context

A **context** is a named bundle of trusted settings for an editor. The browser only ever sends the context's name, `site.project-update`, and the name grants nothing by itself, because every request is checked against what the module registered.

`features` turns on bold, italic, lists, ordinary links, links to Craft pages (`craftLink`), mentions and images. Mentions, page links and images also need their own settings, which each narrow what's allowed. `MentionConfig` only offers members of Project Team, `ElementLinkConfig` only links to other projects, and `AssetConfig` sends uploads to Project Images, with up to four images per update.

`resolveScope` and `authorize` both run before any of Editor's endpoints does anything. `resolveScope` checks what a request is about. The template tells the browser the ID of the project being edited, the browser sends it back with each request, and `resolveScope` checks it's a real, live project. Returning `null` refuses the request. `authorize` then checks who is asking, so only people with the permission can search for teammates, search for projects or upload a photo.

See [Context Settings](../developers/context-settings.md) for every context setting.

## Register the Module

Craft only loads modules that are listed in `config/app.php`. List it under `modules`, and add its ID to `bootstrap` so it loads on every request rather than only when one of its URLs is visited. Add these two keys to the array the file already returns, alongside anything else in it, such as Craft's `id`:

```php
'modules' => [
    'project-updates' => \modules\projectupdates\Module::class,
],
'bootstrap' => ['project-updates'],
```

If your project already has `modules` or `bootstrap` entries, add this module to those lists rather than replacing them.

The `bootstrap` entry is what makes this work. Editor's endpoints, its Twig filters and the context all depend on the module running on every request, including a request for a project page that never calls the module's own controller.

## Add the Save Action

Team members save the update through the module's own controller action. Create `modules/projectupdates/controllers/UpdatesController.php`:

```php
<?php
namespace modules\projectupdates\controllers;

use modules\projectupdates\Module;

use Craft;
use craft\web\Controller;

use verbb\editor\Editor;

use yii\base\UserException;
use yii\web\NotFoundHttpException;
use yii\web\Response;

class UpdatesController extends Controller
{
    public function actionSave(): ?Response
    {
        $this->requirePostRequest();
        $this->requirePermission(Module::PERMISSION);

        $entry = Module::getProjectEntry((int)$this->request->getRequiredBodyParam('entryId'));

        if (!$entry) {
            throw new NotFoundHttpException('Project not found.');
        }

        $config = Editor::$plugin->getEditorConfigs()->requireConfigByHandle(Module::CONTEXT);
        $documents = Editor::$plugin->getDocuments();
        $body = $this->request->getBodyParam('statusUpdate');

        try {
            // The save boundary: limits, the context's features and sanitising.
            $richText = $documents->normalize($body, $config);

            if ($richText->isEmpty()) {
                throw new UserException('Write an update before saving.');
            }

            $imageIds = [];

            foreach ($richText->extractReferences() as $reference) {
                if ($reference->nodeType === 'editorAsset' && $reference->referenceId()) {
                    $imageIds[] = (int)$reference->referenceId();
                }
            }

            // Moves this person's new uploads into the volume. Images already on the entry pass
            // through, whoever added them. Anything else is refused.
            Editor::$plugin->getAssets()->finalize(
                array_map(fn(int $id) => ['id' => $id, 'kind' => 'inlineImage'], $imageIds),
                $config,
                static::currentUser()->id,
                $entry->statusImages->ids(),
            );
        } catch (UserException $e) {
            return $this->asFailure($e->getMessage(), routeParams: ['submittedUpdate' => $body]);
        }

        $entry->setFieldValue('statusUpdate', $richText->toJson());
        $entry->setFieldValue('statusImages', $imageIds);

        if (!Craft::$app->getElements()->saveElement($entry)) {
            return $this->asFailure('Couldn’t save the update.', routeParams: ['submittedUpdate' => $body]);
        }

        return $this->asSuccess('Update saved.');
    }
}
```

`requirePermission()` checks the same permission that `authorize` checks, because the save action is a separate request and needs its own check. Guests and members without the permission are refused with a 403, and Craft checks the form's CSRF token automatically. The project comes from `getProjectEntry()`, so an update can't be written onto an entry outside Projects.

`normalize()` is the save boundary, where the untrusted JSON from the browser becomes a document you're willing to store. It checks the document against the context's size limits, removes anything the context doesn't allow and strips each mention, page link and photo back to a reference, such as a user's ID and name or an Asset's ID and alt text. If a document is too large or has too many images, it throws a `DocumentLimitException`, whose message is safe to show.

Photos need one more step. When a team member adds a photo, Editor uploads it straight away as a temporary Asset that only they own, and it isn't in Project Images yet. `finalize()` moves their new uploads into the volume. It also takes the photos already in Status Images, which lets a teammate edit someone else's update without losing that person's photos. Any other Asset is refused, so an update can't borrow a photo from somewhere else.

Once the document has passed, the module saves its JSON into Status Update and its photo IDs into Status Images, and saves the entry. A photo that's been taken out of the update is dropped from Status Images at the same time. If anything is refused, `asFailure()` shows the message and sends the submitted JSON back to the template, so the person's text is still in the editor.

## Give the Editor Its Starting Content

Unlike a note that's posted once, an update is edited in place, so the editor needs to open with what's already saved. Create `modules/projectupdates/variables/ProjectUpdatesVariable.php`:

```php
<?php
namespace modules\projectupdates\variables;

use modules\projectupdates\Module;

use craft\elements\Entry;

use verbb\editor\Editor;
use verbb\editor\RichText;

class ProjectUpdatesVariable
{
    /**
     * The editor's options, starting from the entry's saved update. Holds the viewer's CSRF token,
     * so never cache the page it's on in a shared cache.
     */
    public function editorOptions(Entry $entry): array
    {
        $config = Editor::$plugin->getEditorConfigs()->requireConfigByHandle(Module::CONTEXT);

        // Images need their URLs to show while editing. The editor leaves those out when it submits.
        $content = Editor::$plugin->getDocuments()->resolve(
            RichText::from($entry->statusUpdate),
            $config,
            $entry->statusImages->ids(),
        );

        return $config->browserOptions(['entryId' => $entry->id]) + ['content' => $content->getValue()];
    }
}
```

The saved JSON only holds references, so it can't show a photo by itself. `Documents::resolve()` fills each reference in with what the editor needs to display it, such as a photo's URL and a teammate's current name, and the photo IDs from Status Images say which photos it may use. The editor shows those values but leaves them out of the JSON it submits, so opening the update doesn't count as a change.

`browserOptions()` produces the rest of the editor's options, so you never repeat them by hand. That includes the enabled features, translated interface text, the endpoint URLs and the viewer's CSRF token. The array passed to it becomes the scope that `resolveScope` checks. Because the options include a token for the person viewing, a page that shows the editor must never be stored in a cache that other visitors share, such as Craft's `{% cache %}` tag or a full-page cache.

## Write the Project Template

Create `templates/projects/_entry.twig`. It extends the `_layout.twig` from [What You Need](#what-you-need). Yours can extend whatever layout your site uses.

```twig
{% extends '_layout' %}

{% block content %}
    <h1>{{ entry.title }}</h1>

    <h2>Latest Update</h2>

    {% if entry.statusUpdate %}
        <div class="project-update">
            {{ entry.statusUpdate|editorHtml('site.project-update', false, entry.statusImages.ids()) }}
        </div>
    {% else %}
        <p>No update yet.</p>
    {% endif %}

    {% if currentUser and currentUser.can('site-editProjectUpdates') %}
        {% do editorAssets() %}

        {% set options = craft.projectUpdates.editorOptions(entry) %}

        {# After a refused save, put what they wrote back in the editor. #}
        {% if submittedUpdate is defined %}
            {% set options = options|merge({ content: submittedUpdate }) %}
        {% endif %}

        {% set error = craft.app.session.getFlash('error') %}
        {% set notice = craft.app.session.getFlash('success') %}

        <h2>Edit the Update</h2>

        <form method="post">
            {{ csrfInput() }}
            {{ actionInput('project-updates/updates/save') }}
            {{ redirectInput(entry.url) }}
            {{ hiddenInput('entryId', entry.id) }}

            {% if error %}
                <p class="form-error" role="alert">{{ error }}</p>
            {% elseif notice %}
                <p class="notice" role="status">{{ notice }}</p>
            {% endif %}

            <verbb-editor name="statusUpdate" required aria-label="Project update"
                submit-label="Save update" data-options="{{ options|json_encode }}">
            </verbb-editor>
        </form>
    {% endif %}
{% endblock %}
```

The `editorHtml` filter renders the saved update. Its first argument is the context's handle, which tells it what the document may contain and how to look up its references. The second turns line breaks into `<br>` tags, which an Editor document doesn't need, so it's `false`. The third is the list of photo IDs the update may show, which comes from Status Images. Rendering doesn't depend on who's viewing, so guests and team members see the same update. A teammate who leaves Project Team shows as plain text, and a link to a project that's been deleted keeps its words without the link.

The form only appears for people with the permission. `editorAssets()` registers Editor's browser bundle, which defines the `<verbb-editor>` element and ships inside Editor's Composer package, so there's nothing to build with npm. The element behaves like a form field. Its `name` is `statusUpdate`, so the form submits the document's JSON under that name, `required` stops it saving while it's empty, and `submit-label` adds Editor's own button, labelled “Save update”. `data-options` takes the options from `craft.projectUpdates.editorOptions()`.

See [Element Attributes](../reference/editor-options.md#element-attributes) for its other attributes.

## Give the Project Team Permission

Open **Settings → Users → User Groups → Project Team** in the control panel. Under **Project Updates**, tick **Edit project updates on the front end** and save. Members of the group can now edit updates, and everyone else, signed in or not, can read them.

## Write the First Update

Sign in on the front end as a member of Project Team and open the Community Garden project. You'll see “No update yet.” and, under **Edit the Update**, the editor.

Write an update that tries each feature:

1. Press ⌘B or Ctrl+B and type “Beds”, then press it again to turn bold off.
2. Type “ are built, planting on ”, then press ⌘I or Ctrl+I and type “Saturday” in italic.
3. Press Enter at the end of the line and type `- ` (a hyphen and a space) to start a list, then type “Soil delivery with ”.
4. Type `@` and the first letters of a teammate's name, such as `@Pri`, and choose them, then finish the line with “confirmed”. Someone outside Project Team isn't offered, however much of their name you type.
5. Press Enter for the next item and type “Tools shared with the library”. Select “library”, press ⌘K or Ctrl+K, type “Library” and choose **Library Renovation**. Only projects are offered, never pages from other sections.
6. Add a photo with the **Add photos** button, or drop one on the editor. It uploads straight away and appears in the tray under the text.
7. Choose **ALT** on the photo, describe it, such as “Raised garden beds”, and press Enter.
8. Choose **Save update**.

The page reloads with “Update saved.”, and **Latest Update** shows the bold and italic text, the list, the mention as “@Priya Natarajan”, a link to the Library Renovation project and the photo. The editor below it opens with the same update, photo included, ready for the next change. Reload the page and both look the same.

If the photo doesn't appear, check that Project Images has public URLs and that Status Images can hold Assets from it.

Open the entry in the control panel and you'll see what was stored. Status Update holds the document's JSON, with the teammate as a user ID and name, the project link as an entry ID and the photo as an Asset ID and alt text, and Status Images holds the photo. Each save also creates an entry revision credited to the person who saved it, so the entry's revision history shows who changed the update and when.

## Edit Someone Else's Update

Sign in as the other member of Project Team and open the same project. The editor opens with the first member's update and photo. Add “ at 9am” after “Saturday” and save.

The update now includes the change, and the first member's photo is still there. That works because the save action passes the photos already in Status Images to `finalize()`, which allows them through whoever is saving. Without that list, the second member's save would be refused, because the photo isn't one of their own uploads.

## What Others See

Sign in as the member who isn't on Project Team. They see the latest update, with its mention, links and photo, but no editor. If they send a request to Editor's endpoints or to the save action anyway, it's refused with a 403.

Visitors who aren't signed in see the same update and no editor. Editor's endpoints refuse guests whatever the browser sends. If you did show the editor to guests, `browserOptions()` would keep the basic formatting and ordinary links and turn off mentions, page links and uploads for them, but the save action would still need its own rule for whether guests may save.

## Check What the Module Refuses

The module's rules keep the team inside the Projects section. You can see one hold from your browser's developer tools. Find the hidden `entryId` field in the form, change its value to the ID of an entry in another section, and save. The save action can't find that entry among the projects, so it answers with a 404 and the update isn't saved.

The same rules guard Editor's endpoints. A mention search, page search or upload whose scope names an entry outside Projects is refused with a 403, because `resolveScope` returns `null`. The save action also refuses anyone without the permission with a 403.

## Things to Know About Plain Text Storage

A Plain Text field is a sound place for the JSON, but it wasn't designed for it, which leads to a few things to keep in mind.

The control panel shows the field as raw JSON. Ask editors to leave Status Update alone there, because a hand edit that breaks the JSON makes the whole update show as its raw text, and only the front-end form runs the module's checks.

Plain Text fields turn emoji shortcodes into emoji when they load, so typing `:tada:` in an update saves as 🎉. The rest of the text, including colons and quotation marks, comes back unchanged.

Finally, removing a photo from an update takes it out of Status Images but leaves the Asset in Project Images, as mentioned earlier. If that matters for your site, delete the Assets the save action drops, or tidy up Project Images from time to time.

For a feature that's shared between sites, or one that needs its own records, a plugin is a better home. The [plugin guide](build-a-notes-plugin-with-editor.md) builds one end to end, with its own tables, permission and template.
