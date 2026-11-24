<?php
namespace verbb\editor\web\assets\editor;

use craft\web\AssetBundle;

/**
 * Editor's browser runtime for the front end and the Control Panel. It sets `window.VerbbEditor`,
 * registers the editor (`<verbb-editor>`) and the editor input (`<verbb-editor-input>`), and
 * re-exports Tiptap. Module scripts are deferred, so classic glue awaits
 * `customElements.whenDefined('verbb-editor')` before touching the global.
 */
class EditorAsset extends AssetBundle
{
    // Public Methods
    // =========================================================================

    public function init(): void
    {
        $this->sourcePath = __DIR__ . '/dist';
        $this->js = ['editor.js'];
        $this->jsOptions = ['type' => 'module'];
        $this->css = ['editor.css'];

        parent::init();
    }
}
