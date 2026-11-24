import { provideFeatures } from './features/registry';
import * as Editor from './public';

export * from './public';

/**
 * The entry for the bundle Editor ships through Composer. It's one ES module, so `import(url)` works
 * and an extension built through the `Tiptap` re-export shares this Tiptap instance. The global is
 * for classic scripts, which must await `customElements.whenDefined('verbb-editor')` because module
 * scripts are deferred. It registers the editor, `<verbb-editor>`, and the editor input,
 * `<verbb-editor-input>`. Links, mentions, uploads and GIF search are separate chunks beside it,
 * loaded when an editor uses them.
 */
// Each feature is its own chunk beside this file, loaded only when an editor's options use it.
provideFeatures({
    link: () => import('./features/link'),
    linkTools: () => import('./features/link-tools'),
    mention: () => import('./features/mention'),
    uploads: () => import('./features/uploads'),
    gifs: () => import('./gifs/index'),
});

Object.assign(window, { VerbbEditor: Editor });

Editor.registerVerbbEditorInputElement();
Editor.registerVerbbEditorElement();
