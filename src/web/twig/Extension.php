<?php
namespace verbb\editor\web\twig;

use verbb\editor\Editor;
use verbb\editor\models\EditorConfig;
use verbb\editor\RichText;
use verbb\editor\web\assets\editor\EditorAsset;

use Craft;

use Twig\Extension\AbstractExtension;
use Twig\TwigFilter;
use Twig\TwigFunction;

class Extension extends AbstractExtension
{
    // Public Methods
    // =========================================================================

    public function getFilters(): array
    {
        return [
            new TwigFilter('editorHtml', [$this, 'editorHtml'], ['is_safe' => ['html']]),
            new TwigFilter('editorPlain', [$this, 'editorPlain']),
        ];
    }

    public function getFunctions(): array
    {
        return [
            new TwigFunction('editorAssets', [$this, 'editorAssets']),
        ];
    }

    /**
     * `$context` is required so a template states its intent: a registered handle or config, or
     * `null` to render structured nodes as text because nothing can vouch for them.
     */
    public function editorHtml(mixed $value, EditorConfig|string|null $context, bool $nl2br = false, array $associatedAssetIds = []): string
    {
        $config = $this->_config($context);

        if ($config === null) {
            return RichText::from($value)->toHtml($nl2br);
        }

        return Editor::getInstance()->getDocuments()->toHtml(RichText::from($value), $config, $nl2br, $associatedAssetIds);
    }

    public function editorPlain(mixed $value, EditorConfig|string|null $context = null, array $associatedAssetIds = []): string
    {
        $config = $this->_config($context);

        if ($config === null) {
            return RichText::from($value)->toPlainText();
        }

        return Editor::getInstance()->getDocuments()->toPlainText(RichText::from($value), $config, $associatedAssetIds);
    }

    public function editorAssets(): void
    {
        Craft::$app->getView()->registerAssetBundle(EditorAsset::class);
    }


    // Private Methods
    // =========================================================================

    private function _config(EditorConfig|string|null $context): ?EditorConfig
    {
        return is_string($context) ? Editor::getInstance()->getEditorConfigs()->requireConfigByHandle($context) : $context;
    }
}
