# Installation & Setup

Editor isn't a Craft plugin, so there's nothing to install in the control panel. It's a Composer package that your plugin, or a module in your Craft project, requires and starts. [Build a Notes Plugin with Editor](../user-guides/build-a-notes-plugin-with-editor.md) walks through a complete plugin, and [Add Editor to a Site Module](../user-guides/add-editor-to-a-site-module.md) does the same for a module in your Craft project.

## Composer

Open your terminal and go to the folder of the package that will use Editor. For a plugin, that's the plugin's own folder. For a site module, it's your Craft project's root. Then require Editor:

```shell
composer require verbb/editor
```

For a plugin, this adds Editor to the `require` section of the plugin's `composer.json`, so anyone who installs your plugin gets Editor with it and site owners never install it separately:

```json
"require": {
    "craftcms/cms": "^5.10.0",
    "verbb/editor": "^1.0.0"
}
```

Editor uses native Craft Assets and has no database tables, so there are no migrations to run. Your plugin keeps its own records and migrations.

## Boot Editor

Boot Editor from your plugin's or module's `init()`, so its endpoints, Twig filters and garbage collection exist on every request:

```php
use verbb\editor\Editor;

public function init(): void
{
    parent::init();

    Editor::bootstrap();

    // The rest of your init()...
}
```

If several plugins on a site use Editor, each calls `bootstrap()` and Editor starts once. [Craft Integration](../developers/craft-integration.md) continues from here, registering a context and putting an editor on a page.

## Browser Code

Editor's Composer package ships one prebuilt browser bundle, so your plugin registers it with `{% do editorAssets() %}` instead of building its own copy of Tiptap, and site owners never run npm. Your plugin's scripts reach the bundle through `window.VerbbEditor`. Build any custom Tiptap extensions through `VerbbEditor.Tiptap`, so they share one Tiptap instance with the editor.

A front end with its own build, such as a React or Vue app, can install `@verbb/editor` from npm instead of loading the bundle. Its version always matches the `verbb/editor` Composer package, because the browser writes the documents the server sanitises and renders, so install the release that matches the site's. The package can be imported during a server render without a DOM, though an editor can only be created in the browser.

[Browser Authoring](../developers/browser-authoring.md#loading-editor-in-the-browser) explains both approaches in more detail.
