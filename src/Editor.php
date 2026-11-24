<?php
namespace verbb\editor;

use verbb\editor\base\PluginTrait;
use verbb\editor\web\twig\Extension;

use Craft;
use craft\services\Gc;

use yii\base\Event;

use Throwable;

use verbb\base\base\Module;

class Editor extends Module
{
    // Constants
    // =========================================================================

    public const ID = 'verbb-editor';


    // Traits
    // =========================================================================

    use PluginTrait;


    // Properties
    // =========================================================================

    public ?string $t9nCategory = 'editor';


    // Public Methods
    // =========================================================================

    public function init(): void
    {
        self::$plugin = $this;

        parent::init();

        $this->_registerComponents();
        $this->_registerTwig();
        $this->_registerGarbageCollection();
    }


    // Private Methods
    // =========================================================================

    private function _registerTwig(): void
    {
        Craft::$app->onInit(function() {
            Craft::$app->getView()->registerTwigExtension(new Extension());
        });
    }

    private function _registerGarbageCollection(): void
    {
        Event::on(Gc::class, Gc::EVENT_RUN, function() {
            // Garbage collection runs other work after this handler, so a failure here must not stop it.
            try {
                $this->getAssets()->deleteExpiredUploads();
            } catch (Throwable $e) {
                self::error('Unable to delete expired Editor uploads: ' . $e->getMessage());
            }
        });
    }
}
