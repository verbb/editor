# Craft Integration

Editor is a Composer/Yii module, not a Craft plugin. Your plugin, or a module in your Craft project, boots it, registers the contexts it uses, and renders saved documents through it, while keeping ownership of its own records, permissions, notifications and file associations. The two [User Guides](../user-guides/build-a-notes-plugin-with-editor.md) build complete examples of everything on this page.

## Bootstrap

Require the package, then boot the module from your plugin's or module's `init()`, so Editor's endpoints, Twig filters and garbage collection exist on every request:

```php
use verbb\editor\Editor;

class MyPlugin extends \craft\base\Plugin
{
    public function init(): void
    {
        parent::init();

        Editor::bootstrap();
    }
}
```

If several plugins on a site use Editor, each calls `bootstrap()` and Editor starts once. Once it's booted, Editor's services are available through `Editor::$plugin` or `Editor::getInstance()`, such as `Editor::$plugin->getDocuments()` for saving and rendering.

Editor has no database tables or migrations. Site owners don't install it or run npm, because it arrives through Composer with your plugin or project.

## Register Contexts

A context is the trusted server configuration behind an editor. It says which features the editor allows, who can be mentioned, which pages can be linked to and where uploads go. Browser requests name a context by its handle, and the handle grants nothing by itself, because everything is checked against what you registered here.

Register your contexts on every request, after Craft has finished loading, because looking up a volume or user group needs Craft's project config. `Craft::$app->onInit()` runs its callback at that point:

```php
use Craft;
use craft\elements\Entry;
use craft\elements\User;
use verbb\editor\Editor;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\ElementLinkConfig;
use verbb\editor\models\MentionConfig;

Craft::$app->onInit(function() {
    $volume = Craft::$app->getVolumes()->getVolumeByHandle('replyImages');

    Editor::$plugin->getEditorConfigs()->registerConfig(new EditorConfig([
        'handle' => 'myplugin.reply',
        'placeholder' => Craft::t('my-plugin', 'Write a reply…'),
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
            'criteria' => [Entry::class => ['section' => 'news']],
        ]),
        'assets' => new AssetConfig([
            'enabled' => $volume !== null,
            'volumeId' => $volume?->id,
            'maxImages' => 5,
        ]),
        'authorize' => fn(User $user, string $capability, EditorConfig $config) => $user->can('myplugin-reply'),
    ]));
});
```

Handles are lowercase, in at least two parts separated by dots, so each plugin keeps its own prefix. Registering a handle twice throws unless you pass `replace: true`. Look up a context with `getConfigByHandle()`, which returns `null` for an unknown handle, or `requireConfigByHandle()`, which throws `EditorConfigNotFoundException`.

[Context Settings](context-settings.md) lists every setting.

### Features

Each feature is off unless you turn it on. Mentions, page links, images and attachments each need two things, their feature key and an enabled settings model. Page links need `'craftLink' => true` and `elementLinks`, mentions need `'mention' => true` and `mentions`, and images or attachments need `'image' => true` or `'attachment' => true` and `assets`. The [features table](context-settings.md#features) lists every key.

A document can hold content for a feature that has since been turned off. It's degraded with its blocks kept separate. A heading becomes a paragraph, a disabled mention becomes its label text, disabled media is removed, and a heading level you don't allow becomes the nearest level you do.

### Limits

Contexts default to `maxNodes` of 10,000, `maxDepth` of 32 and `maxBytes` of 524,288. `AssetConfig` adds `maxImages` and `maxAttachments` per document. `Documents::normalize()` enforces all of these and throws `DocumentLimitException`, whose message is safe to show the author.

## Put an Editor on a Page

The editor element, `<verbb-editor>`, is the usual way to put an editor in a template. It works like a form field, and brings Editor's Post button, character limit, saved drafts and error messages with it.

First, build the editor's options in PHP from your context. `browserOptions()` produces the enabled features, the placeholder, translated interface text, the endpoint URLs and the viewer's CSRF token, so none of that is repeated by hand. A template variable is a convenient place for it:

```php
use verbb\editor\Editor;

public function editorOptions(Thread $thread): array
{
    return Editor::$plugin->getEditorConfigs()
        ->requireConfigByHandle('myplugin.reply')
        ->browserOptions(['ownerId' => $thread->id]);
}
```

The array you pass becomes the request's scope, which [Scope Requests](#scope-requests) explains. Then register Editor's browser bundle and add the element to your form:

```twig
{% do editorAssets() %}

{% set options = craft.myPlugin.editorOptions(thread) %}

<form method="post">
    {{ csrfInput() }}
    {{ actionInput('my-plugin/replies/save') }}
    {{ hiddenInput('threadId', thread.id) }}

    <verbb-editor name="body" required aria-label="Reply" submit-label="Reply"
        data-options="{{ options|json_encode }}">
    </verbb-editor>
</form>
```

`editorAssets()` registers the bundle, which defines the element. When the form submits, the document's JSON arrives in your save action as `body`. The [Editor Options](../reference/editor-options.md#element-attributes) page lists the element's other attributes, and [Posting](../feature-tour/posting.md) shows how to post with your own JavaScript instead.

Because the options hold the viewer's CSRF token, never store a page that shows an editor in a cache other visitors share, such as Craft's `{% cache %}` tag or a full-page cache.

Guests get basic editing with no endpoints, because `browserOptions()` turns mentions, page links and uploads off for anyone who isn't signed in. Your save action still decides whether guests may post at all.

### Mount Without the Element

To build your own frame around the editor, create one with the bundle's `Editor` class. The bundle is an ES module, which browsers run after the page has parsed, so a classic script has to wait for the element to be defined before it uses `window.VerbbEditor`:

```twig
{% do editorAssets() %}

<div id="reply-editor"></div>

{% js at endBody %}
customElements.whenDefined('verbb-editor').then(() => {
    VerbbEditor.Editor.create('#reply-editor', {{ options|json_encode(constant('JSON_HEX_TAG'))|raw }});
});
{% endjs %}
```

`JSON_HEX_TAG` keeps a `</script>` inside the options from ending the script early. [Browser Authoring](browser-authoring.md) covers submitting a document from an editor created this way. From PHP, register `verbb\editor\web\assets\editor\EditorAsset` instead of calling `editorAssets()`.

## Scope Requests

Endpoints often need to know which thread or record a request is about. Whatever you pass to `browserOptions()` comes back from the browser as `scope`. Your `resolveScope` callable checks it against the user, and what it returns becomes `referenceContext` for that request. Return `null` to refuse.

```php
'resolveScope' => function(array $scope, User $user, EditorConfig $config): ?array {
    $thread = MyPlugin::$plugin->getThreads()->getThreadById((int)($scope['ownerId'] ?? 0));

    return $thread && $thread->canReply($user) ? ['thread' => $thread] : null;
},
```

`resolveScope` runs before `authorize`, and `referenceContext` only ever holds what your own code returned, so providers and `authorize` can trust it. Without a callable, the client's scope is ignored.

## Save a Document

`Documents` is the entry point for saving and rendering. In your save action, read the submitted JSON and pass it through `normalize()`:

```php
use verbb\editor\Editor;

$documents = Editor::$plugin->getDocuments();
$config = Editor::$plugin->getEditorConfigs()->requireConfigByHandle('myplugin.reply');

$richText = $documents->normalize($this->request->getBodyParam('body'), $config);

if ($richText->isEmpty()) {
    // Refuse the post.
}

$reply->body = $richText->toJson();
```

`normalize()` is the save boundary. It enforces limits and applies the context's features and sanitising. Stored documents hold references only. An image keeps its `id`, `alt` and `title`, an attachment its `id`, and a mention or page link its `id`, `type` and `label`. URLs and file details always come from resolution, so they can't be forged or go stale. Ordinary links to an address keep their `href`.

An empty document serialises as `{"type":"doc","content":[]}`. `RichText::isEmpty()` is true when there's no visible text and no mention, image or attachment, so an image on its own still counts as content. `RichText::getTextLength()` counts characters the same way as the editor's `limit`, without image alt text or attachment filenames, so use it for a length limit on the server.

`RichText::from()` takes a `RichText`, an array, or a string. A string is a document only if it decodes to a `doc` object or a non-empty array of objects with a string `type`. Any other string is literal text, including `[]` and `<b>bold</b>`. Use `RichText::fromHtml()`, `fromJson()` or `fromText()` when you know what you have.

## Render a Document

Rendering turns each reference back into something readable, using its current details. Pass the IDs of the Assets your plugin has recorded against the document, from your own association rows, because a document may only show those:

```php
use verbb\editor\RichText;

$assetIds = MyPlugin::$plugin->getReplies()->getAssetIds($reply);

$html = $documents->toHtml(RichText::from($reply->body), $config, associatedAssetIds: $assetIds);
$text = $documents->toPlainText(RichText::from($reply->body), $config, $assetIds);
```

In Twig, the `editorHtml` and `editorPlain` filters do the same. `editorHtml` takes the context's handle, whether to turn line breaks into `<br>` tags (an Editor document doesn't need this, so pass `false`), and the Asset IDs. `editorPlain` takes the handle and the Asset IDs.

```twig
{{ reply.body|editorHtml('myplugin.reply', false, assetIds) }}
{{ reply.body|editorPlain('myplugin.reply', assetIds) }}
```

Rendering never depends on the viewer's control panel permissions, so guests and members see what authors wrote. A context can opt in with [`requireViewPermission`](context-settings.md#requireviewpermission) for a surface only the control panel shows. Rendering also never throws for a missing reference:

| Reference | When it can't be resolved |
| --- | --- |
| Mention | Its stored label, as plain text |
| Page link | Its link text, without the link |
| Image or attachment | Removed |

Without a context, nothing can vouch for a reference, so mentions become their label, images their alt text and page links their text.

For lists, `renderAll()` resolves each kind of reference once across every document. Key the documents and their Asset IDs the same way, and it returns HTML under those keys:

```php
$html = $documents->renderAll($richTexts, $config, associatedAssetIds: $assetIdsByKey);
```

To edit a saved document, hand the browser its resolved form, so images and attachments can display. The editor keeps those values for display and leaves them out of the JSON it submits, so opening a document never marks it dirty.

```php
$content = $documents->resolve(RichText::from($reply->body), $config, $assetIds);
```

Pass `$content->getValue()` as the editor's `content` option.

## Mentions

The default provider mentions Craft users. It searches name fields only, never email, and returns active users only. Nobody can be mentioned until you say who, with trusted user query `criteria`, an `eligibleIds` callable that returns the eligible people for each request, or both. [Mention Config](context-settings.md#mention-config) describes each setting.

To use something else, set `mentionProvider` to your own `MentionProviderInterface`. Mentions and notifications stay yours. After a save, `Documents::extractMentions()` returns a `DocumentReference` for each mention, with the user's ID from `referenceId()`, so you can notify the people mentioned:

```php
foreach ($documents->extractMentions($richText) as $mention) {
    $userId = (int)$mention->referenceId();
    // Send your own notification.
}
```

## Craft Links

Page links let the Link control search your site. Set `elementLinks` with an `ElementLinkConfig` and turn on the `craftLink` feature. `elementTypes` lists what can be linked, `criteria` narrows each type with trusted query criteria, and `eligibility` is an optional callable for rules a query can't express. Only live content is linked by default.

```php
use craft\elements\Entry;
use verbb\editor\models\ElementLinkConfig;

'features' => [
    'link' => true,
    'craftLink' => true,
],
'elementLinks' => new ElementLinkConfig([
    'enabled' => true,
    'elementTypes' => [Entry::class],
    'criteria' => [Entry::class => ['section' => 'news']],
]),
```

The Link control suggests pages before a search, in each type's default order, and shows each page's section or group under it, or what an optional `describe` callable returns. [Element Link Config](context-settings.md#element-link-config) has the full list.

## Uploads

Uploads start as temporary Craft Assets owned by the uploader, and become permanent when your plugin finalises them after a save. Build the list of uploads from the normalised document. `extractReferences()` names images with the node type `editorAsset` and files with `attachment`, and `finalize()` expects the kinds `inlineImage` and `attachment`:

```php
$references = [];

foreach ($richText->extractReferences() as $reference) {
    $kind = match ($reference->nodeType) {
        'editorAsset' => 'inlineImage',
        'attachment' => 'attachment',
        default => null,
    };

    if ($kind && $reference->referenceId()) {
        $references[] = ['id' => (int)$reference->referenceId(), 'kind' => $kind];
    }
}

$finalized = Editor::$plugin->getAssets()->finalize($references, $config, $currentUser->id, $associatedAssetIds);
```

Finalising moves the user's temporary uploads into your configured folder under their original filename, checking your context's file rules again. Assets you list in `$associatedAssetIds` pass through, so editing a document keeps its media, whoever is editing. Anything else is refused with an exception whose message is safe to show. It returns each Asset's `id`, `filename`, `url`, `kind`, `mimeType` and `size`. Record the IDs against your document, because they're the Asset IDs you pass when rendering.

`finalize()` checks every reference before it moves any file, so a refusal leaves the uploads where they were. Call it before you start a database transaction, then save your record and its Asset rows inside it. A moved file can't be rolled back if your own save then fails, but a retry from the same person recognises it as already finalised.

Removing a node from a document never deletes an Asset. Abandoned temporary uploads are deleted by Craft's garbage collection after 24 hours, so there's nothing to schedule. Each user can have up to 20 uploads waiting to be saved. [Asset Config](context-settings.md#asset-config) covers the allowed extensions and size limits.

A provider that only serves files, such as one that delivers them through a private download route, implements `AssetResolverInterface` and is set as `assetProvider`. Editor still handles uploading.

### Upload Safety

Every upload through Editor passes `verbb\editor\helpers\UploadSafety`, whatever the context allows. It refuses SVG, HTML, XML, script and program files by name and by contents, any file whose contents don't match its extension, and TIFF images. It removes images' metadata, including where a photo was taken, and turns a photo upright first when Craft's `rotateImagesOnUploadByExifData` is on. HEIC and AVIF images are stripped with ImageMagick when PHP has the Imagick extension and refused when it doesn't.

Uploads that don't go through Editor, such as a front-end Assets field on your plugin's form, can get the same treatment. `check()` cleans the file in place and sets its `type` from its contents, or throws `verbb\editor\errors\UploadRefusedException`. Its message is safe to show, and its `reason` is one of the class's `REASON_*` constants, for when you'd rather show your own message:

```php
use verbb\editor\errors\UploadRefusedException;
use verbb\editor\helpers\UploadSafety;

foreach (UploadedFile::getInstancesByName('fields[photos]') as $file) {
    // Check your own allowed extensions and size first.
    try {
        UploadSafety::check($file);
    } catch (UploadRefusedException $e) {
        $errors[] = $e->getMessage();
    }
}
```

A provider of your own that implements `AssetUploaderInterface` should call `check()` too, since Editor's checks are in its own Craft Assets handling. `UploadSafety::canStripHeicAndAvif()` says whether this server accepts HEIC and AVIF, so a settings page can say so beside your allowed file types.

Uploads wait on Craft's temporary upload filesystem, set by the `tempAssetUploadFs` general config setting, until a document keeps them. If that filesystem has public URLs, anyone with an address could open a file nobody has checked yet, so Editor refuses every upload while it does, with a message saying uploads are turned off and a warning in Craft's log. `UploadSafety::temporaryUploadsArePublic()` tells a settings page when to warn about it, and a plugin that keeps its own uploads on that filesystem can refuse them the same way.

## Custom Extensions

Pass trusted Tiptap PHP extensions through `extensions` on the context. Implement `ExtensionPolicyInterface` to say which attributes of a custom node or mark are safe. Without a policy, Editor keeps a custom node's text and removes the node. A browser extension also needs this PHP counterpart for its content to survive saving.

## Endpoints

Editor's endpoints refuse guests, need a CSRF token and accept only POST requests that ask for a JSON response. Searches send a JSON body, and uploads a multipart one. They respond in Craft's usual format, with `{results: [...]}` for searches, `{asset: {...}}` for uploads, and `{message}` with a 4xx status for a refusal. An unexpected failure is logged and returns a generic 500.

### Your Own Endpoints

A plugin that identifies people some other way, such as a bearer token for a front end on another domain, can send the editor's requests to its own controller instead. Pass the URLs as the second argument to `browserOptions()`, and set the browser's [`request` option](browser-authoring.md#request-headers-and-credentials) for the headers that controller expects.

```php
use craft\helpers\UrlHelper;

$options = $config->browserOptions(['ownerId' => $thread->id], [
    'mentions' => UrlHelper::actionUrl('my-plugin/api/mentions'),
    'upload' => UrlHelper::actionUrl('my-plugin/api/upload'),
]);
```

The keys are `mentions`, `elements` and `upload`, and any other key throws. An override only replaces the URL of an endpoint the context already uses, so it never turns a feature on.

Your controller receives the same requests Editor's would. Searches send a JSON body with `query`, `context` and `scope`, and uploads a multipart body with `file`, `kind`, `context` and `scope` (as a JSON string). After its own authentication, the controller makes the same checks Editor's endpoints do with `getEditorConfigs()->resolveRequestConfig()`. That finds the context, runs your `resolveScope` and `authorize` callables, and throws an HTTP exception with a message that's safe to show. Then it answers in the same shapes, using the context that method returns:

```php
use verbb\editor\Editor;
use verbb\editor\enums\Capability;

// The person your bearer token identified.
$user = $this->getTokenUser();

$config = Editor::$plugin->getEditorConfigs()->resolveRequestConfig(
    $this->request->getRequiredBodyParam('context'),
    $this->request->getBodyParam('scope', []),
    $user,
    Capability::Mentions,
);

// Editor's endpoints cap a search at 200 characters.
$query = mb_substr((string)$this->request->getBodyParam('query', ''), 0, 200);

return $this->asSuccess(data: [
    'results' => Editor::$plugin->getMentions()->search($query, $config),
]);
```

Uploads use `Capability::Upload` and `getAssets()->upload($file, $config, $kind)`, and page searches use `Capability::Elements` and `getElements()->search()`. The browser shows a 4xx response's `message` and hides anything else behind a generic error.

Editor still sends the page's CSRF token, in the body and as `X-CSRF-Token`, to whichever URL you give it, unless `browserOptions()` reports `csrfToken: false`. A front end on another domain sends no Craft cookies, so Craft's CSRF validation would refuse its requests.

::: warning
Turn off CSRF validation for your controller only when it identifies the person by the bearer token alone and never falls back to Craft's session cookie. A request that's authenticated by the session cookie without CSRF protection could be forged by any other site.
:::

`browserOptions()` also turns mentions, uploads and page links off when there's no signed-in user, so set the person your token identifies as the user identity before calling it.
