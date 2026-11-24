# Context Settings

A context is the trusted server configuration behind an editor, registered from your plugin or module with `registerConfig()`. [Craft Integration](craft-integration.md#register-contexts) shows where that call goes and how a context is used. This page lists every setting, starting with `EditorConfig` itself and then the three settings models that turn on mentions, page links and uploads.

```php
use verbb\editor\Editor;
use verbb\editor\models\EditorConfig;

Editor::$plugin->getEditorConfigs()->registerConfig(new EditorConfig([
    'handle' => 'myplugin.reply',
    'features' => ['bold' => true, 'italic' => true, 'link' => true],
]));
```

Editor validates a context when you register it. An unknown feature key, a malformed handle, a callable setting that isn't callable or an invalid settings model makes `registerConfig()` throw an `InvalidConfigException` that names the problem, so a mistake shows up the first time the code runs.

## Editor Config

These are the properties of `verbb\editor\models\EditorConfig`.

::: reference
### `handle`

**Type:** `string` · **Required**

The name the browser uses to refer to this context, such as `myplugin.reply`. It's made of lowercase letters, digits and dashes, in at least two parts separated by dots, so each plugin can keep its handles under its own prefix. The handle grants nothing by itself, because every request is checked against the context registered under it.

Registering the same handle twice throws, because that's almost always two plugins claiming one name. Pass `replace: true` to `registerConfig()` when you mean to swap a context out, such as after your plugin's settings change during a request.
:::

::: reference
### `features`

**Type:** `array` · **Default:** `[]`

Which formatting and content the editor allows, keyed by feature. Every feature is off unless you turn it on, and the same list decides what the browser offers, what the server keeps when it saves and what it renders. See [Features](#features) for the keys.
:::

::: reference
### `placeholder`

**Type:** `string|null` · **Default:** `null`

The text shown in an empty editor, such as “Write a reply…”. Pass it through `Craft::t()` so it's translated. Without one, the editor shows “Write something…”.
:::

::: reference
### `labels`

**Type:** `array` · **Default:** `[]`

Replacements for the editor's interface text, keyed like the labels that `browserOptions()` sends. Editor already translates its own text through Craft's `editor` translation category, so use this only for a wording you want to change in one context, such as `['posting' => Craft::t('my-plugin', 'Sending…')]` for the Post button's progress text.
:::

::: reference
### `mentions`

**Type:** `MentionConfig|null` · **Default:** `null`

Who can be mentioned. The `mention` feature does nothing until this is set and enabled. See [Mention Config](#mention-config).
:::

::: reference
### `elementLinks`

**Type:** `ElementLinkConfig|null` · **Default:** `null`

Which Craft elements, such as entries, can be linked to from the Link control. The `craftLink` feature does nothing until this is set and enabled. See [Element Link Config](#element-link-config).
:::

::: reference
### `assets`

**Type:** `AssetConfig|null` · **Default:** `null`

Where uploads go and which files are allowed. The `image` and `attachment` features do nothing until this is set and enabled. See [Asset Config](#asset-config).
:::

::: reference
### `gifs`

**Type:** `GifConfig|null` · **Default:** `null`

GIF search through [GIPHY](https://giphy.com). With a key, the toolbar gets a GIF control, and the GIF someone chooses goes with the document rather than inside it. See [GIF Config](#gif-config).
:::

::: reference
### `authorize`

**Type:** `callable|null` · **Default:** `null`

Decides whether the signed-in person may use this context's mention search, page search or uploads. It's called for every request to those endpoints, after [`resolveScope`](#resolvescope):

```php
'authorize' => fn(User $user, string $capability, EditorConfig $config): bool => $user->can('myplugin-reply'),
```

`$capability` is `upload`, `mentions` or `elements`, so you can allow searching but not uploading, for example. Without this callable, anyone signed in may use the context's endpoints. Guests are always refused, whatever this returns.

`authorize` only guards Editor's endpoints. Your own save action still needs its own permission check.
:::

::: reference
### `resolveScope`

**Type:** `callable|null` · **Default:** `null`

Checks what a request is about. Whatever your template passes to `browserOptions()` as the scope, such as `['ownerId' => $thread->id]`, comes back from the browser with each request. This callable receives it, checks it against the person asking and returns what the request may use, or `null` to refuse it:

```php
'resolveScope' => function(array $scope, User $user, EditorConfig $config): ?array {
    $thread = MyPlugin::$plugin->getThreads()->getThreadById((int)($scope['ownerId'] ?? 0));

    return $thread && $thread->canReply($user) ? ['thread' => $thread] : null;
},
```

What it returns becomes [`referenceContext`](#referencecontext) for that request. Without this callable, the scope the browser sends is ignored.
:::

::: reference
### `referenceContext`

**Type:** `array` · **Default:** `[]`

What `resolveScope` returned for the current request. Editor sets it on a copy of the context for each endpoint request, so your providers, [`eligibleIds`](#eligibleids) and `describe` callables can rely on it. It only ever holds what your own code returned, never what the browser sent. You don't normally set it yourself.
:::

::: reference
### `requireViewPermission`

**Type:** `bool` · **Default:** `false`

Whether mentions, page links and images only show when the person viewing has Craft's permission to view that user, element or Asset. Front-end content shouldn't depend on who's reading it, so leave this off there. Turn it on for an editor that only appears in the control panel, where those permissions are meaningful.
:::

::: reference
### `extensions`

**Type:** `array` · **Default:** `[]`

Tiptap PHP extensions for custom nodes and marks, which must match the browser extensions you pass to the editor. An extension that implements `ExtensionPolicyInterface` decides which of its attributes are safe to keep through `sanitizeAttributes()`. Without a policy, Editor keeps a custom node's text and removes the node.
:::

::: reference
### `mentionProvider`

**Type:** `MentionProviderInterface|null` · **Default:** `null`

Your own source of people to mention, in place of Craft users. Without one, Editor searches Craft users as [Mention Config](#mention-config) describes.
:::

::: reference
### `elementProvider`

**Type:** `ElementProviderInterface|null` · **Default:** `null`

Your own source of linkable pages, in place of Craft element queries. Without one, Editor searches the element types in [Element Link Config](#element-link-config).
:::

::: reference
### `assetProvider`

**Type:** `AssetResolverInterface|AssetUploaderInterface|null` · **Default:** `null`

Your own handling for files. A provider that implements `AssetResolverInterface` decides how saved images and attachments are displayed, such as serving them through a private download route. One that implements `AssetUploaderInterface` handles uploading and finalising too. Editor uses its own Craft Assets handling for whichever half your provider doesn't implement.
:::

::: reference
### `maxNodes`

**Type:** `int` · **Default:** `10000`

The most nodes (paragraphs, list items, text runs, mentions and so on) a saved document can hold. `Documents::normalize()` throws a `DocumentLimitException` above it, with a message that's safe to show the author.
:::

::: reference
### `maxDepth`

**Type:** `int` · **Default:** `32`

How deeply nodes can nest, such as a list inside a quote inside a list. Enforced the same way as `maxNodes`.
:::

::: reference
### `maxBytes`

**Type:** `int` · **Default:** `524288`

The largest a document's JSON can be, in bytes (512 KB). Enforced the same way as `maxNodes`. Store documents in a column that can hold this much, such as a `mediumText`.
:::

## Features

Turn a feature on by setting its key to `true` in [`features`](#features). `headings` also takes a list of levels.

| Key | Allows | Toolbar control |
| --- | --- | --- |
| `bold` | Bold text | `bold` |
| `italic` | Italic text | `italic` |
| `strike` | Strikethrough | `strike` |
| `underline` | Underlined text | `underline` |
| `code` | Inline code | `code` |
| `headings` | Headings. `true` allows levels 2 and 3, or list the levels you want, such as `[2, 3, 4]` | `heading` |
| `lists` | Bulleted and numbered lists | `bulletList` and `orderedList` |
| `blockquote` | Quotes | `blockquote` |
| `link` | Links to any address | `link` |
| `craftLink` | Links to pages on your site, which also needs [`elementLinks`](#elementlinks) | `link` |
| `image` | Uploaded images, which also needs [`assets`](#assets) | `attach` |
| `attachment` | Uploaded files, which also needs [`assets`](#assets) | `attach` |
| `mention` | Mentions, which also needs [`mentions`](#mentions) | `mention` |

GIF search isn't a feature key, because a GIF isn't part of the document. Set [`gifs`](#gifs) to give the toolbar its `gif` control.

The toolbar control is the name to use in the browser's [`toolbar`](../reference/editor-options.md#toolbar) option, which arranges the bar. `link` and `craftLink` share one Link control, and `image` and `attachment` share one attach control.

A saved document can hold content for a feature that has since been turned off. When it's saved or rendered again, a heading becomes a paragraph, a disabled mention becomes its label text, disabled media is removed, and a heading level you no longer allow becomes the nearest one you do.

## Mention Config

`verbb\editor\models\MentionConfig` decides who can be mentioned. By default, Editor suggests active Craft users, searching their names and never their email addresses. Nobody can be mentioned until you set `criteria`, `eligibleIds` or both, so a forgotten setting never exposes your whole user list.

```php
use verbb\editor\models\MentionConfig;

'mentions' => new MentionConfig([
    'enabled' => true,
    'criteria' => ['group' => 'members'],
]),
```

::: reference
### `enabled`

**Type:** `bool` · **Default:** `false`

Whether mentions are on for this context. The context's `mention` feature must be on too.
:::

::: reference
### `criteria`

**Type:** `array|null` · **Default:** `null`

User query criteria that limit who can be mentioned, such as `['group' => 'members']`. Anything a Craft user query accepts works here. `[]` allows every active user. Inactive users are never suggested, whatever the criteria say.
:::

::: reference
### `eligibleIds`

**Type:** `callable|null` · **Default:** `null`

Narrows who can be mentioned for each request, such as the people already in a thread. It receives the request's [`referenceContext`](#referencecontext) and returns user IDs:

```php
'eligibleIds' => fn(array $referenceContext, EditorConfig $config): array => $referenceContext['thread']->getParticipantIds(),
```

With this set, typing <kbd>@</kbd> suggests those people straight away, before a name is typed. When `criteria` is set too, a person has to match both.
:::

::: reference
### `describe`

**Type:** `callable|null` · **Default:** `null`

The line under each person's name in the suggestions, such as “Author” or “Moderator”. Return `null` for no line:

```php
'describe' => fn(User $user, array $referenceContext, EditorConfig $config): ?string => $user->id === $referenceContext['thread']->authorId ? 'Author' : null,
```

A person's photo appears beside their name when their photo's volume has public URLs.
:::

::: reference
### `minQueryLength`

**Type:** `int` · **Default:** `2`

How many letters someone types after <kbd>@</kbd> before Editor searches. Suggestions from `eligibleIds` appear before that.
:::

::: reference
### `limit`

**Type:** `int` · **Default:** `10`

The most people suggested at once, up to 50.
:::

## Element Link Config

`verbb\editor\models\ElementLinkConfig` decides which pages on your site can be linked to from the Link control. Only live elements are offered by default.

```php
use craft\elements\Entry;
use verbb\editor\models\ElementLinkConfig;

'elementLinks' => new ElementLinkConfig([
    'enabled' => true,
    'elementTypes' => [Entry::class],
    'criteria' => [Entry::class => ['section' => 'news']],
]),
```

Turn on the `craftLink` feature as well, or the Link control only takes addresses.

::: reference
### `enabled`

**Type:** `bool` · **Default:** `false`

Whether page links are on for this context. The context's `craftLink` feature must be on too.
:::

::: reference
### `elementTypes`

**Type:** `array` · **Default:** `[]`

The element classes that can be linked, such as `Entry::class` and `Category::class`.
:::

::: reference
### `criteria`

**Type:** `array` · **Default:** `[]`

Element query criteria for each type, keyed by its class, such as `[Entry::class => ['section' => 'news']]`. Each key must also be listed in `elementTypes`. Criteria are applied last, so they can change the default `live` status if you need to.
:::

::: reference
### `siteIds`

**Type:** `array` · **Default:** `[]`

The sites to search, by ID. Empty means the current site.
:::

::: reference
### `eligibility`

**Type:** `callable|null` · **Default:** `null`

A rule that a query can't express, checked for each result. Return `false` to leave an element out:

```php
'eligibility' => fn(ElementInterface $element, EditorConfig $config): bool => !$element->getFieldValue('hideFromLinks'),
```
:::

::: reference
### `describe`

**Type:** `callable|null` · **Default:** `null`

The line under each page in the suggestions. By default it's the entry's section, the category's group or the element type's name:

```php
'describe' => fn(ElementInterface $element, EditorConfig $config): ?string => $element->postDate?->format('j M Y'),
```
:::

::: reference
### `limit`

**Type:** `int` · **Default:** `10`

The most pages suggested at once, up to 50.
:::

## Asset Config

`verbb\editor\models\AssetConfig` decides where uploads go and which files are allowed. Uploads start as temporary Assets owned by the person uploading, and move into the volume when your plugin saves the document, as [Uploads](craft-integration.md#uploads) explains.

```php
use verbb\editor\models\AssetConfig;

'assets' => new AssetConfig([
    'enabled' => true,
    'volumeId' => $volume->id,
    'maxImages' => 4,
]),
```

::: reference
### `enabled`

**Type:** `bool` · **Default:** `false`

Whether uploads are on for this context. The context's `image` or `attachment` feature must be on too.
:::

::: reference
### `volumeId`

**Type:** `int|null` · **Default:** `null`

The volume that saved uploads move into. It's needed for uploads to be saved and displayed, so look the volume up by handle and turn uploads off when it's missing. A volume whose filesystem has public URLs lets images display directly.
:::

::: reference
### `folderId`

**Type:** `int|null` · **Default:** `null`

A folder inside the volume for saved uploads. Without one, uploads go in the volume's root folder.
:::

::: reference
### `allowedExtensions`

**Type:** `array` · **Default:** `[]`

The file extensions allowed, such as `['pdf', 'docx']`. Images default to jpg, jpeg, png, gif and webp when this is empty. Attachments have no default, so list them here to allow any. Types Editor never accepts, such as `svg`, `html` and `js`, are left out even when listed, as [Upload Safety](craft-integration.md#upload-safety) explains.
:::

::: reference
### `maxFileSize`

**Type:** `int|null` · **Default:** `null`

The largest upload allowed, in bytes. It can only lower Craft's own `maxUploadFileSize`, which applies when this is empty.
:::

::: reference
### `maxImages`

**Type:** `int|null` · **Default:** `null`

The most images one document can hold. The editor refuses an extra image before uploading it, and `Documents::normalize()` refuses a document over the limit.
:::

::: reference
### `maxAttachments`

**Type:** `int|null` · **Default:** `null`

The most attachments one document can hold, enforced the same way as `maxImages`.
:::

Each person can have up to 20 uploads waiting to be saved at once, across every context. Uploads that are never saved are deleted by Craft's garbage collection after 24 hours.

## GIF Config

`GifConfig` turns on GIF search for a context:

```php
use verbb\editor\models\GifConfig;

'gifs' => new GifConfig([
    'apiKey' => App::env('GIPHY_API_KEY'),
    'rating' => 'pg',
]),
```

GIPHY's API terms require each visitor's browser to search GIPHY itself, so `browserOptions()` includes the key for anyone who can use the editor, guests included. It's GIPHY's key for the web, which GIPHY expects to be public. A new key is limited to 100 searches an hour until you apply to GIPHY for a production key.

The chosen GIF isn't part of the document, so saving it is up to you. Read it in the browser with [`getGif()`](../reference/editor-options.md#getgif), or from the form under the element's `gif-name`, and check it on the server with `verbb\editor\helpers\Giphy::normalize()`, which returns `['url' => …, 'width' => …, 'height' => …]` for one of GIPHY's own addresses and `null` for anything else. See [GIFs From GIPHY](browser-authoring.md#gifs-from-giphy).

::: reference
### `apiKey`

**Type:** `string|null` · **Default:** `null`

Your key for the web from the [GIPHY developer dashboard](https://developers.giphy.com/dashboard/). Without one there's no GIF control.
:::

::: reference
### `enabled`

**Type:** `bool` · **Default:** `true`

Whether GIF search is on, so a setting can turn it off without removing the key.
:::

::: reference
### `rating`

**Type:** `string` · **Default:** `'g'`

The highest content rating to search: `g`, `pg`, `pg-13` or `r`.
:::

::: reference
### `limit`

**Type:** `int` · **Default:** `24`

How many GIFs to show for each search, up to 50.
:::

::: reference
### `language`

**Type:** `string|null` · **Default:** `null`

The two-letter language for searches, such as `fr`. `null` uses the site's language.
:::
