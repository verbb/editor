# Verbb Editor

`@verbb/editor` is the browser half of [Editor](https://github.com/verbb/editor), the rich-text editor that Verbb's Craft CMS plugins use for comments, replies and messages on the front end. It writes Tiptap JSON that the `verbb/editor` Composer library sanitises and renders on the server, so install the version that matches your `verbb/editor` release.

```ts
import { Editor, type EditorOptions } from '@verbb/editor';
import '@verbb/editor/styles';

// The output of EditorConfig::browserOptions() for your context, which your page or API supplies.
// It holds the features, placeholder, labels and Craft endpoints the server allows.
declare const serverOptions: EditorOptions;

const form = document.querySelector<HTMLFormElement>('#message-form')!;
const input = form.elements.namedItem('body') as HTMLInputElement;

const editor = new Editor('#message', {
    ...serverOptions,
    ariaLabel: 'Message',
});

form.addEventListener('submit', () => {
    input.value = JSON.stringify(editor.getJSON());
});
```

The server's options set every feature and the placeholder, so spread them first and add browser-only options such as `ariaLabel` or `toolbar` after them. Without a server, pass `preset` and `placeholder` instead.

The package also provides the editor element `<verbb-editor>` and the bare editor input `<verbb-editor-input>`, registered with `registerVerbbEditorElement()` and `registerVerbbEditorInputElement()`. Both take part in forms like any other field.

Mentions, page links and uploads talk to endpoints on your Craft site. Pass `request` to add headers, such as a bearer token, or to send Craft's session cookie to another origin.

See [Browser Authoring](https://docs.verbb.io/editor/developers/browser) for using the editor from JavaScript, and [Editor Options](https://docs.verbb.io/editor/developers/editor-options) for every option, method and event.
