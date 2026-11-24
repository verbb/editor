# Editor Docs

VitePress site for [docs.verbb.io/editor](https://docs.verbb.io/editor/), using the shared `@verbb/vitepress-theme`.

From the **package root** (directory with main `composer.json`):

```bash
npm install
npm run dev:plugin-docs
```

Preview: [http://localhost:5412/editor/](http://localhost:5412/editor/)

## Build

```bash
npm run build:plugin-docs
```

Output goes to `docs/.vitepress/dist`, built for the `/editor/` base path.

## Live Demos

The Feature Tour pages embed the real editor, `<verbb-editor>`, with `<EditorDemo>` and `<EditorPlayground>` (in `.vitepress/theme/demo`). The docs import `@verbb/editor` from `packages/editor/src`, so the demos always match the current source without building the package first.

There's no Craft site behind the docs. `fakeCraft.ts` answers the demos' people search, page search and upload requests in the browser, using the same response shapes as Editor's controllers. Each demo can be set to fail its uploads, people search or posting.
