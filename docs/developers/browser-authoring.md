# Browser Authoring

This page covers working with the editor from JavaScript, such as submitting its document yourself, reacting to changes, sending requests with your own headers and matching your site's colours. Your plugin still decides who may submit content, saves the document, and renders the saved result through PHP, as [Craft Integration](craft-integration.md) explains. [Editor Options](../reference/editor-options.md) lists every option, method, attribute and event.

## Loading Editor in the Browser

How your code reaches Editor depends on whether Craft renders the page.

In a Craft plugin or module, register Editor's prebuilt bundle with `{% do editorAssets() %}`, as [Craft Integration](craft-integration.md#put-an-editor-on-a-page) shows. The bundle registers `<verbb-editor>` and `<verbb-editor-input>`, and sets `window.VerbbEditor`, which holds the `Editor` class, the element classes and Tiptap. Your own scripts use that global. Don't `import` from `@verbb/editor` in a script the browser loads directly, because a bare package name doesn't resolve there. If your plugin's scripts are TypeScript, you can still install the npm package for its types, with `import type`.

The bundle is an ES module, and browsers run modules after the page has parsed. A classic script waits for the element before touching the global:

```js
customElements.whenDefined('verbb-editor').then(() => {
    const { Editor } = window.VerbbEditor;

    // Use Editor here.
});
```

A front end with its own build, such as a React or Vue app, installs `@verbb/editor` from npm instead and imports from it. Install the release that matches the site's `verbb/editor` Composer package, because the browser writes the documents the server sanitises and renders.

```js
import { Editor, registerVerbbEditorElement } from '@verbb/editor';
import '@verbb/editor/styles';

registerVerbbEditorElement();
```

The examples on this page use the bundle's global. With the npm package, import the same names instead.

## Features That Load on Demand

Editor's bundle keeps links, mentions and uploads in files of their own beside `editor.js`, and loads each one only when an editor's features use it. A page whose editors only format text never downloads them.

The elements load what they need by themselves. Their `editor` property is `null` until then, so wait for `ready`, which resolves with the editor:

```js
const element = document.querySelector('verbb-editor');
const editor = await element.ready;
```

To create an editor yourself, use `Editor.create()`, which loads the features first and resolves with the editor. `new Editor()` throws when a feature its options use hasn't loaded, because an editor built without it would drop that content, such as the links in a saved document. A script that adds elements can call `VerbbEditor.loadFeatures()` with the same options first, and each element then has its editor the moment it's added.

If a feature can't be loaded, Editor never builds the editor without it. `ready` rejects and the element fires `editor-error`, so your page can keep its own fallback, such as a plain text box.

The feature files load from beside `editor.js`, so a content security policy that allows `editor.js` allows them too, including a nonce on the script that loads it.

With the npm package every feature is included, so `new Editor()` works straight away and your own bundler decides how to split the code.

## Submit a Document From Your Own Form

The editor element, `<verbb-editor>`, takes part in forms by itself, so most plugins need no JavaScript to submit a document. When you create an editor with the `Editor` class instead, your script copies its document into the form when it submits:

```html
<form id="message-form">
    <div id="message-editor"></div>
    <input type="hidden" name="body">
    <button type="submit">Send message</button>
</form>
```

```js
customElements.whenDefined('verbb-editor').then(async () => {
    const { Editor } = window.VerbbEditor;
    const form = document.querySelector('#message-form');

    // serverOptions is the output of browserOptions() for your context.
    const editor = await Editor.create('#message-editor', {
        ...serverOptions,
        ariaLabel: 'Message',
    });

    form.addEventListener('submit', () => {
        form.elements.body.value = JSON.stringify(editor.getJSON());
    });

    form.addEventListener('reset', () => editor.reset());
});
```

`getJSON()` returns the document's content array, holding references only. Your save action receives it as `body` and passes it through `Documents::normalize()`, where permissions and Editor's sanitising are applied. Treat `getHTML()` as an editing preview, and render saved content through PHP for public output.

Check `isUploading()` before submitting, or use the `onUploadState` option to disable your button while files upload. Call `editor.destroy()` before discarding a mounted editor. Each editor has its own content, requests and state, so a page can hold several.

## State and Content

A new or cleared editor is empty. `isEmpty()` is true when there's no visible text and no mention, image or attachment, the same rule the server uses. `isDirty()` compares the current document with its starting point, including formatting and which people, pages or files it refers to.

`setContent()` replaces the document and reports one update. `reset()` restores the starting document, marks it clean and clears the undo history. Pass a document to `reset(document)` to set a new clean starting point after a successful save. Loading content is never an undo step.

A string is a document only if it decodes to a `doc` object or a non-empty array of objects with a string `type`. Any other string is literal text, including `123`, `[]` and `<b>bold</b>`, and the server applies the same rule. Use `editor.importHTML(html)` to read HTML through the enabled features, and pass `{ baseline: true }` when that HTML is the saved document rather than a change to it.

`getText()` gives the same plain text as the server's `toPlainText()`, with a blank line between top-level blocks and a line break between list items. `getTextLength()` is the count the element's `limit` uses, which is that plain text without image alt text or attachment filenames, in Unicode characters. The server's `RichText::getTextLength()` counts the same way, so enforce your own limit with it and the browser and server always agree.

`onUpdate` receives `{ editor, json, html, text }`, and `onChange` also receives `isDirty`. Programmatic replacements and resets report changes too. These callbacks don't save anything by themselves.

To edit a saved document, pass the result of `Documents::resolve()` as `content`, so its media can display. An upload result can have a `null` URL, because temporary Assets don't have public URLs yet. The editor shows those images from a local preview that's never included in the saved JSON or HTML.

## GIFs From GIPHY

With [`gifs`](../reference/editor-options.md#gifs) set, usually through a context's [`GifConfig`](context-settings.md#gif-config), the toolbar has a GIF control. It opens a search above the control that shows what's trending until someone types, with “Powered by GIPHY” as GIPHY's terms require. Nothing contacts GIPHY until someone opens it, and its code is a chunk of its own, loaded then too. The chosen GIF shows under the text with a button to remove it.

The GIF goes with the document, not inside it, so a post can be just a GIF and you decide where it's kept. `<verbb-editor>` treats a GIF as something to post, so its Post button works without text, and keeps the GIF in a draft. Read it with `editor.getGif()`, or give the element a `gif-name` to submit it with a form as JSON:

```html
<verbb-editor name="body" gif-name="gif" data-options="{{ options|json_encode }}"></verbb-editor>
```

On the server, check it before saving with `Giphy::normalize()`, which only accepts one of GIPHY's own addresses:

```php
use verbb\editor\helpers\Giphy;

$gif = Giphy::normalize($request->getBodyParam('gif'));
```

Once the post is saved, call `editor.reportGifSent()`, which tells GIPHY the GIF was sent, as its terms ask.

A page that offers GIFs without the editor, such as a plain text box, can use the same search on its own from `@verbb/editor/gifs`, which doesn't load the editor or Tiptap:

```js
import { GifPicker } from '@verbb/editor/gifs';

const picker = new GifPicker({
    config: { apiKey: 'your-giphy-key', rating: 'pg' },
    onChoose: ({ gif, sent }) => { /* keep gif, and ping `sent` with picker.search.giphy.ping(sent) once posted */ },
    onClose: () => picker.element.remove(),
});

container.append(picker.element);
picker.open();
```

Pass `classes` to give each part your own class names, and `labels` for your own wording. `GifSearch` and `Giphy` are there too, for drawing the results yourself.

## Features and the Server

The server's `browserOptions()` sends every feature for your context, so in a Craft plugin you don't choose features in the browser at all. Without a server context, the `preset` option picks a starting set, and `features` overrides individual ones, such as `{ headings: [2, 3, 4] }`.

Browser features only control what the editor offers. They don't grant permission or change what the server keeps. Mentions, page links and uploads also need the `craft` value from `browserOptions()`, which holds the context's handle, its endpoint URLs and the viewer's CSRF token. That value is `false` for guests, so those features are off for them. If a request needs a CSRF token and none can be found, the editor reports a setup error in the console rather than sending the request.

The [Feature Tour](../feature-tour/writing-formatting.md) shows how each feature behaves for the person writing, including the [Link control](../feature-tour/links.md), [mention suggestions](../feature-tour/mentions.md) and the [uploads tray](../feature-tour/uploads.md). Resource requests are debounced and cancelled when a newer one replaces them, and authentication, network and server failures show in the control without stopping ordinary editing.

## Request Headers and Credentials

Mention searches, page searches and uploads send Craft's session cookie to their own origin, which is all a Craft-rendered page needs. A front end that identifies people another way, or talks to Craft on another origin, passes `request`:

```js
const editor = await Editor.create('#reply', {
    ...serverOptions,
    request: {
        headers: async () => ({ Authorization: `Bearer ${await getToken()}` }),
        credentials: 'omit',
    },
});
```

Here `getToken()` stands for however your front end gets a current token. `headers` can be a fixed object, or a function that's called before each request so a short-lived token stays current. `credentials` works as it does for `fetch()`, and [`request`](../reference/editor-options.md#request) describes each value.

Editor's own `Accept`, `Content-Type` and CSRF headers always win over the same names in `headers`. Uploads use `XMLHttpRequest` so they can report progress, and it always sends cookies to its own origin, so `omit` only changes searches there. A request to another origin needs that server to allow it with CORS, including any headers you add.

To send these requests somewhere other than Editor's own endpoints, change their URLs on the server through [`browserOptions()`](craft-integration.md#your-own-endpoints), so they reach a controller that understands your headers. `request` and the endpoint URLs only shape requests, and the server still checks every one.

The elements take `request` through `element.options` or `data-options`. JSON can only hold a fixed `headers` object, so set a headers function through the property. The two are merged, so `data-options` can set `credentials` while your script adds the function.

## Strings and Labelling

`browserOptions()` sends every interface string already translated through Craft's `editor` translation category. Pass `labels` to replace any of them. Strings that include a count, such as “Too long by 2 characters”, use Craft's ICU plural syntax, `{count, plural, one{Too long by # character} other{Too long by # characters}}`, and the editor picks the form that suits the page's language, so a translation can give each plural form its own wording. Give each editor an accessible name with `ariaLabel`, `ariaLabelledBy`, or a `<label>` for one of the elements.

## The Editor Element

```twig
<form method="post">
    <verbb-editor name="body" required aria-label="Reply to Alex" reply-to="Alex" submit-label="Reply" limit="2000"
        draft-key="reply:{{ currentUser.id }}:{{ comment.id }}" data-options="{{ options|json_encode }}">
        <span slot="header">Posting as <b>{{ currentUser.friendlyName }}</b></span>
        <button slot="actions" type="reset" class="verbb-editor__button">Cancel</button>
    </verbb-editor>
</form>
```

`<verbb-editor>` is the editor itself. It puts the editor input in a frame with a reply chip, your own slotted content and a Post button, and adds a character limit, saved drafts and post errors. `data-options` takes the JSON of `browserOptions()`, held here in `options`. [Element Attributes](../reference/editor-options.md#element-attributes) lists every attribute and slot.

<kbd>⌘↵</kbd> or <kbd>Ctrl+Enter</kbd>, the Post button and `element.requestSubmit()` do nothing while the editor is empty, over its limit, uploading, holding a failed upload or `busy`. Otherwise they fire a cancellable `editor-submit` event, then submit the form. To post with your own request, cancel the event, set `busy`, and afterwards reset the form or call `element.showPostError()`, which keeps the text and offers **Try again**. [Posting](../feature-tour/posting.md#when-posting-fails) has a complete example.

A draft is forgotten on reset, after a submission nothing cancelled, and when you call `element.clearDraft()`.

Cancelling a reply fires a cancellable `editor-reply-cancel` event, with the name in `detail.name`, then removes `reply-to`. Listen for it to clear whatever links the reply to its parent, such as a hidden parent ID field, or call `preventDefault()` to keep the reply.

## The Editor Input Element

`<verbb-editor-input>` is the bare editor input, the text box with its toolbar and uploads tray, for a page that builds its own frame. It takes the same form attributes as `<verbb-editor>`, without the Post button, limit, drafts or reply chip.

Both elements submit their JSON under `name`, or an empty string when there's no document. A `<label>` names the field, and a click on one focuses it. Modern browsers treat them as real form fields, so `required`, `disabled` (including a disabled fieldset), form reset and validation work as for any input. A form won't validate while an upload is in flight or has failed, or while `<verbb-editor>` is over its limit. Browsers without `ElementInternals` get a hidden input that handles submitting and resetting.

Set `element.options` from a script for options JSON can't hold, or `element.value` before the element is on the page to choose the document it starts from and resets to. Later options merge with earlier ones. Attribute changes update the existing editor, keeping edits, focus and uploads, and only `preset` rebuilds it, keeping its content. The elements fire bubbling `editor-update`, `editor-change` and `editor-upload-state` events, and `element.editor` gives you the editor underneath, with every [method](../reference/editor-options.md#methods).

## Themes

`light` is the default theme. `dark` has no background of its own, so it sits on your page's dark surface. `craft` takes the control panel's colours, and `browserOptions()` sends it on control panel requests. `none` keeps the layout and leaves colours to your site, apart from giving floating menus a surface of their own. The main stylesheet includes every theme. The `@verbb/editor/themes/*` files hold only each theme's colours, so load one alongside `@verbb/editor/styles`, never in place of it.

Map your own design tokens once, on the element or any element around it:

```css
.comments verbb-editor {
    --verbb-editor-accent: var(--comments-accent);
    --verbb-editor-bg: var(--comments-surface);
    --verbb-editor-radius: var(--comments-radius);
}
```

| Token | Styles |
| --- | --- |
| `--verbb-editor-accent` and `-accent-fg` | The Post button, links, mentions, focus rings, text selection and pressed tools, and the text on the Post button |
| `--verbb-editor-bg` and `-fg` | The editor's background and text |
| `--verbb-editor-muted` | Secondary text, such as the header and file details |
| `--verbb-editor-border` | The frame's border |
| `--verbb-editor-hover` | Hovered tools, inline code and empty thumbnails |
| `--verbb-editor-pop-bg` | Menus, notices and the drop area |
| `--verbb-editor-bubble` and `-bubble-fg` | The selection bubble and tooltips |
| `--verbb-editor-overlay` and `-overlay-fg` | The layer over an uploading or failed photo, and its buttons |
| `--verbb-editor-avatar-1` to `-avatar-8` and `-avatar-fg` | Initials avatars in mention suggestions |
| `--verbb-editor-danger` and `-warning` | Errors, and the limit counter as it nears the limit |
| `--verbb-editor-radius` | Corner radius |
| `--verbb-editor-font-family`, `-font-size`, `-line-height` and `-code-font` | Type |
| `--verbb-editor-min-height` and `-max-height` | The writing area's height, which scrolls past the maximum |

Menus are placed inside their editor, inherit its theme, and flip or shorten to stay on screen. The editor adapts to its own width rather than the screen's. In a narrow space the tools scroll in one row, and narrower still the Post button becomes an arrow, as [Narrow Spaces](../feature-tour/looks-layout.md#narrow-spaces) shows.

## Custom Extensions

Pass native Tiptap extensions through the `extensions` option, and reach native commands through `editor.tiptap`. Build extensions through the bundle's `VerbbEditor.Tiptap`, or the npm package's `Tiptap` export, so they share the editor's copy of Tiptap. A custom node or mark also needs a matching PHP extension and a trusted policy on the context, as [Custom Extensions](craft-integration.md#custom-extensions) explains, because a browser extension alone can't make stored custom content safe or renderable.
