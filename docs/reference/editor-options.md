# Editor Options

This page lists everything the browser side of Editor accepts. That covers the options for `Editor.create()` and `new Editor()` and for both elements, the methods on an editor, and the attributes, properties and events of `<verbb-editor>` and `<verbb-editor-input>`. [Browser Authoring](../developers/browser-authoring.md) explains how they fit together.

Most options come from the server. `EditorConfig::browserOptions()` produces `features`, `placeholder`, `labels`, `craft` and, in the control panel, `theme`, all from your [context](../developers/context-settings.md). Pass its output as it is, then add browser-only options such as `toolbar`, `ariaLabel` or `request` after it, so the server's choices aren't overwritten by accident.

```js
const { Editor } = window.VerbbEditor;

const editor = await Editor.create('#reply-editor', {
    ...serverOptions,
    ariaLabel: 'Reply',
    toolbar: ['bold', 'italic', 'link', 'mention'],
});
```

Here `serverOptions` is the output of `browserOptions()`, which your template passes to the page. The elements take the same options through their `data-options` attribute or `options` property.

## Creating an Editor

::: reference
### `Editor.create()`

**Returns:** `Promise<Editor>`

Returns the editor once the features its options use have loaded. It takes the same element or selector and options as `new Editor()`. With Editor's bundle, use it instead of `new Editor()`, which throws when a feature hasn't loaded, as [Features That Load on Demand](../developers/browser-authoring.md#features-that-load-on-demand) explains.
:::

::: reference
### `loadFeatures()`

**Returns:** `Promise<void>`

Returns a promise that resolves once the features these options use have loaded, such as links, mentions and uploads, so a `new Editor()` or an element created afterwards has its editor straight away. The bundle has it as `VerbbEditor.loadFeatures()`, and both element classes have it too. It rejects if a feature can't be loaded, and with the npm package it resolves at once.
:::

## Options

::: reference
### `content`

**Type:** `array|object|string` · **Default:** `[]`

The document the editor starts with, and returns to on `reset()`. It takes the `doc.content` array that `getJSON()` returns, a whole `{ type: 'doc', content: [...] }` object, or a string. A string is treated as a document only if it decodes to one, and any other string becomes literal text, so `<b>bold</b>` shows its tags. Use `importHTML()` to read HTML.

To edit a saved document, pass the result of `Documents::resolve()` here, so its images and attachments can display.
:::

::: reference
### `preset`

**Type:** `'minimal'|'standard'|'full'` · **Default:** `'standard'`

A starting set of features for an editor without a server context. `minimal` allows bold and italic. `standard` adds strikethrough, lists, quotes, inline code and links. `full` also allows underline and headings 2 and 3. `browserOptions()` sends every feature, so the preset has no effect once its output is passed in.
:::

::: reference
### `features`

**Type:** `object` · **Default:** the preset's features

The individual features to turn on or off, using the same keys as the server's [features](../developers/context-settings.md#features), such as `{ headings: [2, 3, 4], link: false }`. These control what the editor offers. They never grant anything on the server, which applies its own context when it saves.
:::

::: reference
### `placeholder`

**Type:** `string|null` · **Default:** `'Write something…'`

The text shown in an empty editor. `browserOptions()` sends the context's placeholder, and `null` there falls back to the default.
:::

::: reference
### `labels`

**Type:** `object` · **Default:** English labels

The replacements for any interface text, keyed by label. `browserOptions()` sends every label already translated through Craft's `editor` category, so you'd only pass this yourself outside Craft.
:::

::: reference
### `toolbar`

**Type:** `array|false` · **Default:** `['bold', 'italic', 'link', 'bulletList', 'blockquote', 'mention', 'attach', 'gif']`

The enabled controls that sit on the toolbar, in order. Controls that are enabled but not listed go under **More**, along with undo, redo and **Formatting help**. A listed control whose feature is off doesn't appear. The names are `bold`, `italic`, `underline`, `strike`, `code`, `heading`, `bulletList`, `orderedList`, `blockquote`, `link`, `mention`, `attach` and `gif`, and the [features table](../developers/context-settings.md#features) shows which feature each one needs.

`false` leaves the toolbar out, which suits a context with no formatting features turned on.
:::

::: reference
### `toolbarPosition`

**Type:** `string` · **Default:** `'bottom'`

The place the toolbar sits, either `'bottom'`, just under the text, or `'top'`, above it. In `<verbb-editor>`, a bottom toolbar shares the footer's row with the Post button. Once you put something in the `footer` slot, such as a form's own fields, it stays with the text instead, and the text and its toolbar are outlined as one box with your fields after it and Post on its own row below. That way the toolbar never reads as the whole form's.
:::

::: reference
### `theme`

**Type:** `'light'|'dark'|'craft'|'none'` · **Default:** `'light'`

The theme that sets the editor's colours. `dark` has no background of its own and sits on your page's dark surface. `craft` takes the control panel's colours, and `browserOptions()` sends it on control panel requests. `none` keeps the layout and leaves colours to your stylesheet. See [Themes](../developers/browser-authoring.md#themes) for mapping your own colours.
:::

::: reference
### `ariaLabel`

**Type:** `string` · **Default:** none

The editor's accessible name, read by screen readers, such as “Reply to Alex”. Give every editor a name, through this, `ariaLabelledBy` or a `<label>` for one of the elements.
:::

::: reference
### `ariaLabelledBy`

**Type:** `string` · **Default:** none

The ID of an element on the page whose text names the editor, such as a visible heading.
:::

::: reference
### `editable`

**Type:** `bool` · **Default:** `true`

Whether the editor starts out editable. Use `setEditable()` to change it later.
:::

::: reference
### `craft`

**Type:** `object|false` · **Default:** `false`

The settings the editor uses to reach Editor's endpoints for mentions, page search and uploads. Pass the `craft` value from `browserOptions()` as it is. It's `false` for guests, which turns those features off.

| Key | Holds |
| --- | --- |
| `context` | The context's handle |
| `endpoints` | The `mentions`, `elements` and `upload` URLs the context uses |
| `csrfTokenName` and `csrfToken` | Craft's CSRF token, or `csrfToken: false` when the site has CSRF protection off |
| `scope` | What your template passed to `browserOptions()`, sent back unread for [`resolveScope`](../developers/context-settings.md#resolvescope) to check |
| `uploads` | The allowed extensions, file size and per-document counts, so the editor can refuse a file before uploading it |
| `minQueryLength` | How many letters to type before a mention search |

Without a `csrfToken`, the editor reads the token from `<meta name="csrf-token">` and its name from `<meta name="csrf-token-name">`. If neither is there, it reports a setup error in the console rather than sending a request Craft would refuse.

None of this grants anything. The server checks every request against the registered context.
:::

::: reference
### `request`

**Type:** `object` · **Default:** `{}`

The extra headers and cookie handling for mention, page search and upload requests, for a front end that identifies people some other way, such as a bearer token, or talks to Craft on another origin. See [Request Headers and Credentials](../developers/browser-authoring.md#request-headers-and-credentials).

`request.headers` is an object, or a function (which may be async) that's called before each request, so a short-lived token is always current. If the function throws, the request isn't sent, and the person writing sees “Unable to connect” while the error goes to the console. Editor's own `Accept`, `Content-Type` and CSRF headers win over the same names here.

`request.credentials` works as it does for `fetch()`. `same-origin` sends cookies only to the page's own origin, `include` also sends them to another origin, and `omit` sends none. Uploads always send cookies to their own origin, because they use `XMLHttpRequest` to report progress.
:::

::: reference
### `gifs`

**Type:** `object|false` · **Default:** `false`

The settings for GIF search through GIPHY, normally the `gifs` value from `browserOptions()`, with `apiKey`, `rating`, `limit` and `language`. With a key, the toolbar gets a GIF control that opens GIPHY's search in a popover above it, loaded the first time someone opens it. The GIF someone chooses shows under the text with a button to remove it, and goes with the document rather than inside it, so read it with [`getGif()`](#getgif). See [GIF Config](../developers/context-settings.md#gif-config).
:::

::: reference
### `gif`

**Type:** `object|null` · **Default:** `null`

The GIF the editor starts with, as `{ url, width, height }`, such as the one an edited post was saved with. It's part of the clean starting point, like `content`.
:::

::: reference
### `extensions`

**Type:** `array` · **Default:** `[]`

The extra Tiptap extensions for custom nodes and marks. Build them through `VerbbEditor.Tiptap` (or the npm package's `Tiptap` export) so they share the editor's copy of Tiptap. A custom node or mark also needs a matching PHP extension in the context's [`extensions`](../developers/context-settings.md#extensions), or the server removes it when the document is saved.
:::

::: reference
### `onUpdate`

**Type:** `function` · **Default:** none

A function called whenever the document or its GIF changes, including a programmatic `setContent()` or `reset()`, with `{ editor, json, html, text, gif }`. Nothing is saved automatically.
:::

::: reference
### `onChange`

**Type:** `function` · **Default:** none

A function called alongside `onUpdate`, with the same values plus `isDirty`, which says whether the document differs from where it started.
:::

::: reference
### `onUploadState`

**Type:** `function` · **Default:** none

A function called when uploads start or finish, with `{ editor, uploading, pending }`. `uploading` is whether any upload is in flight, and `pending` is how many. Use it to disable your own submit button while files are still uploading.
:::

## Methods

These are the methods of an editor created with `Editor.create()` or `new Editor()`, which the elements also expose through `element.editor`.

::: reference
### `getJSON()`

**Returns:** `array`

Returns the document to submit, as the `doc.content` array. It holds references only, such as a mention's user ID and label, and leaves out the URLs and file details the server filled in for display. Send it as a JSON string to your save action, where `Documents::normalize()` checks it.
:::

::: reference
### `getHTML()`

**Returns:** `string`

Returns an HTML preview of the document while editing. Render saved content through PHP instead, because only the server can resolve references safely.
:::

::: reference
### `getText()`

**Returns:** `string`

Returns the document as plain text, the same as the server's `toPlainText()`, with a blank line between paragraphs and a line break between list items.
:::

::: reference
### `getTextLength()`

**Returns:** `int`

Returns how many characters of writing the document holds, the count `limit` uses. It's the plain text from `getText()` without image alt text or attachment filenames, counted in Unicode characters, so an emoji counts once. The server's `RichText::getTextLength()` gives the same number.
:::

::: reference
### `setContent()`

**Arguments:** `content`, the new document, in any form the [`content`](#content) option accepts.

**Returns:** `void`

Replaces the document and reports one update.
:::

::: reference
### `importHTML()`

**Arguments:** `html`, the HTML to read, and `options`, an optional object.

**Returns:** `void`

Reads HTML into the editor through its enabled features, dropping anything they don't allow. Pass `{ baseline: true }` when the HTML is the saved document rather than a change to it, so the editor isn't marked dirty.
:::

::: reference
### `clear()`

**Returns:** `void`

Empties the document and reports one update.
:::

::: reference
### `reset()`

**Arguments:** `content`, an optional document to make the new starting point, and `gif`, the GIF to start with alongside it.

**Returns:** `void`

Restores the starting document and GIF, marks the editor clean and clears the undo history. Pass a document to start from it instead, such as after a successful save, with no GIF unless you pass one.
:::

::: reference
### `getGif()`

**Returns:** `object|null`

Returns the GIF going with the document, as `{ url, width, height }` with GIPHY's address for it, or `null`. It's never part of `getJSON()`.
:::

::: reference
### `setGif()`

**Arguments:** `gif`, as `{ url, width, height }`, or `null` to remove it.

**Returns:** `void`

Sets or removes the GIF going with the document and reports one update.
:::

::: reference
### `reportGifSent()`

**Returns:** `void`

Tells GIPHY the chosen GIF was sent, as its API terms ask. Call it once the post it went with has been saved. A GIF set with `setGif()` or the `gif` option wasn't chosen in this editor, so there's nothing to report.
:::

::: reference
### `isEmpty()`

**Returns:** `bool`

Returns whether the document has no visible text and no mention, image or attachment. A document with only a photo isn't empty. The server's `RichText::isEmpty()` uses the same rule.
:::

::: reference
### `isDirty()`

**Returns:** `bool`

Returns whether the document differs from its starting point, including formatting and which people, pages or files it refers to.
:::

::: reference
### `isUploading()`

**Returns:** `bool`

Returns whether any upload is still in flight. Check it before submitting the document yourself.
:::

::: reference
### `setEditable()`

**Arguments:** `editable`, `true` to allow editing or `false` for read-only display.

**Returns:** `void`

Switches between editing and read-only display, keeping the content. An upload that finishes after the editor goes read-only still lands in the document.
:::

::: reference
### `setTheme()`

**Arguments:** `theme`, one of the values the [`theme`](#theme) option accepts.

**Returns:** `void`

Changes the theme without replacing the content.
:::

::: reference
### `setPlaceholder()`

**Arguments:** `placeholder`, the new text, or `null` for none.

**Returns:** `void`

Changes the placeholder text.
:::

::: reference
### `setAccessibleName()`

**Arguments:** `name`, an object with `ariaLabel` or `ariaLabelledBy`.

**Returns:** `void`

Changes the editor's accessible name.
:::

::: reference
### `focus()`

**Returns:** `void`

Moves focus into the writing area.
:::

::: reference
### `blur()`

**Returns:** `void`

Moves focus out of the writing area.

::: reference
### `destroy()`

**Returns:** `void`

Removes the editor, its menus and its uploads tray from the page. Call it before throwing away a mounted editor.
:::

The `tiptap` property gives you the underlying Tiptap editor for native commands, and `id` is a unique ID for the instance.

## Element Attributes

Both `<verbb-editor>` and `<verbb-editor-input>` take these attributes. An attribute wins over the same option in `data-options`, and changing one updates the editor in place, keeping whatever has been written.

| Attribute | Meaning |
| --- | --- |
| `name` | The form field name the document's JSON is submitted under |
| `gif-name` | The form field name a chosen GIF is submitted under, as JSON. Without it, only the document is submitted. |
| `data-options` | The JSON of `browserOptions()`, plus any other options |
| `theme`, `preset` and `placeholder` | The same as the options of that name. Changing `preset` rebuilds the editor, keeping its content. |
| `required` | The form won't submit while the editor is empty |
| `disabled` | Not editable and left out of the form, as for any field. A disabled fieldset does the same. |
| `readonly` | Not editable, but still submitted |
| `aria-label` and `aria-labelledby` | The editor's accessible name |
| `form` | The ID of a form elsewhere on the page that the editor belongs to |

`<verbb-editor>` adds these:

| Attribute | Meaning |
| --- | --- |
| `submit-label` | Shows a Post button with this text. Without it there's no Post button, and your own buttons go in the `actions` slot. |
| `reply-to` | Shows “Replying to” this name above the text, with a button to cancel the reply |
| `limit` | A character limit, counted as [`getTextLength()`](#gettextlength) counts. A ring appears at 80% and counts down the rest, and over the limit the editor won't submit. |
| `draft-key` | Saves an unfinished post in this browser and brings it back on the next visit, with **Discard** to start again. Include the person and what they're replying to in the key. |
| `enter-submits` | <kbd>Enter</kbd> posts and <kbd>Shift+Enter</kbd> starts a new line, except in lists and while choosing a mention |
| `collapsible` | Stays one line tall until someone clicks into it, and closes again if they leave it empty |
| `bare` | No border or background, for a page that already draws the card |
| `busy` | Read-only, with “Posting…” on the Post button, while your code posts |

A restored draft only comes back when the editor can be edited as it loads, and uploads more than 23 hours old are left out of it.

`<verbb-editor>` places children by their `slot` attribute:

| Slot | Where it goes |
| --- | --- |
| `header` | Above the text, after the reply chip, for context such as who's posting |
| `above` | Between the header and the text, for your own fields that come first, such as a rating |
| `footer` | After the text and its uploads tray, for your own fields or list of files that go with the post |
| `actions` | Beside the Post button |

With anything in `above` or `footer`, the text and its toolbar are outlined as one box, so your fields read as part of the post rather than part of the text.

## Element Properties and Methods

Both elements have these:

::: reference
### `options`

**Type:** `object`

The element's options, which you can set from a script. New options are merged with what's already set, including a `request.headers` function, which `data-options` can't hold because it's JSON. Setting `content` here also sets the document the form resets to.
:::

::: reference
### `value`

**Type:** `string`

The document as a JSON string, or an empty string when there's no document, never `[]`, which the server would read as the literal text “[]”. Set it before the element is on the page to choose the document it starts from and resets to.
:::

::: reference
### `json`

**Type:** `array`

The document as an array, the same as `getJSON()`. Read-only.
:::

::: reference
### `editor`

**Type:** `Editor|null`

The underlying editor, with every method in [Methods](#methods), or `null` before the element is on the page and while its features load.
:::

::: reference
### `ready`

**Type:** `Promise<Editor>`

A promise of the editor, which resolves once it's mounted, or straight away when it already is. It rejects if a feature the element's options use can't be loaded.
:::

::: reference
### `form`

**Type:** `HTMLFormElement|null`

The form the element belongs to, or `null` when it isn't in one.
:::

::: reference
### `validity`

**Type:** `ValidityState`

The element's validation state, as for any form field.
:::

::: reference
### `validationMessage`

**Type:** `string`

The message that says why the element is invalid, or an empty string when it's valid.
:::

::: reference
### `focus()`

**Returns:** `void`

Moves focus into the writing area.
:::

::: reference
### `checkValidity()`

**Returns:** `bool`

Returns whether the element is valid, as for any form field. The editor is invalid while it's required and empty, while an upload is in flight or has failed, and, for `<verbb-editor>`, while it's over its limit.
:::

::: reference
### `reportValidity()`

**Returns:** `bool`

Returns whether the element is valid, and shows the browser's validation message when it isn't.
:::

`<verbb-editor>` adds these:

::: reference
### `requestSubmit()`

**Returns:** `void`

Posts as the Post button does. Nothing happens while the editor is empty, over its limit, uploading, holding a failed upload or `busy`, and the editor says why. Otherwise it fires `editor-submit`, then submits the form unless that event was cancelled.
:::

::: reference
### `showPostError()`

**Arguments:** `message`, an optional message to show instead of the editor's own.

**Returns:** `void`

Shows that posting failed, keeping the text, with **Try again** to post it again.
:::

::: reference
### `clearPostError()`

**Returns:** `void`

Removes the post error notice.
:::

::: reference
### `clearDraft()`

**Returns:** `void`

Forgets the saved draft. Drafts are also forgotten when the form resets and after a submission nothing cancelled.
:::

## Events

The elements fire these events, which bubble.

| Event | Fired | `detail` |
| --- | --- | --- |
| `editor-update` | When the document changes | `{ editor, json, html, text }` |
| `editor-change` | Alongside `editor-update` | The same, plus `isDirty` |
| `editor-upload-state` | When uploads start or finish | `{ editor, uploading, pending }` |
| `editor-submit` | Before `<verbb-editor>` submits its form. Cancel it to post with your own request. | `{ value, json }`, the document as a JSON string and as an array |
| `editor-reply-cancel` | When someone cancels a reply on `<verbb-editor>`. Cancel it to keep the reply. | `{ name }`, the name in `reply-to` |
| `editor-ready` | When the editor is mounted, after its features load | `{ editor }` |
| `editor-error` | When a feature the element's options use can't be loaded. The element stays without an editor. | `{ error }` |

[Posting](../feature-tour/posting.md#when-posting-fails) shows `editor-submit` used to post with your own request.

## Registering the Elements

Editor's bundle registers both elements when it loads. With the npm package, call `registerVerbbEditorElement()` and `registerVerbbEditorInputElement()` once before using them. Each takes an optional tag name, such as `registerVerbbEditorElement('my-editor')`, for a site that needs its own.
