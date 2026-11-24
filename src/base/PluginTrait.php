<?php
namespace verbb\editor\base;

use verbb\editor\Editor;
use verbb\editor\services\Assets;
use verbb\editor\services\Documents;
use verbb\editor\services\EditorConfigs;
use verbb\editor\services\Elements;
use verbb\editor\services\Mentions;

use Craft;

use verbb\base\LogTrait;
use verbb\base\helpers\Plugin;

trait PluginTrait
{
    // Static Methods
    // =========================================================================

    public static function bootstrap(): void
    {
        Editor::getInstance();
    }

    public static function getInstance(): Editor
    {
        // Register this Yii module on the Craft app if a consuming plugin has
        // not already booted it. Editor is not a Craft plugin, so Craft will
        // not load it automatically from project config.
        if ($module = Craft::$app->getModule(Editor::ID)) {
            /** @var Editor $module */
            return $module;
        }

        $module = new Editor(Editor::ID);
        Editor::setInstance($module);
        Craft::$app->setModule(Editor::ID, $module);

        return $module;
    }


    // Properties
    // =========================================================================

    public static ?Editor $plugin = null;


    // Traits
    // =========================================================================

    use LogTrait;


    // Public Methods
    // =========================================================================

    public function getAssets(): Assets
    {
        return $this->get('assets');
    }

    public function getDocuments(): Documents
    {
        return $this->get('documents');
    }

    public function getEditorConfigs(): EditorConfigs
    {
        return $this->get('editorConfigs');
    }

    public function getElements(): Elements
    {
        return $this->get('elements');
    }

    public function getMentions(): Mentions
    {
        return $this->get('mentions');
    }


    // Private Methods
    // =========================================================================

    private function _registerComponents(): void
    {
        Plugin::bootstrapPlugin('editor');

        $this->setComponents([
            'assets' => Assets::class,
            'documents' => Documents::class,
            'editorConfigs' => EditorConfigs::class,
            'elements' => Elements::class,
            'mentions' => Mentions::class,
        ]);
    }
}
