<?php
namespace verbb\editor\models;

use verbb\editor\base\AssetResolverInterface;
use verbb\editor\base\AssetUploaderInterface;
use verbb\editor\base\ElementProviderInterface;
use verbb\editor\base\MentionProviderInterface;
use verbb\editor\enums\Capability;
use verbb\editor\enums\Feature;
use verbb\editor\helpers\Labels;
use verbb\editor\integrations\assets\CraftAssetProvider;
use verbb\editor\integrations\elements\CraftElementProvider;
use verbb\editor\integrations\mentions\UserMentionProvider;

use Craft;
use craft\base\Model;
use craft\elements\User;
use craft\helpers\UrlHelper;

use Tiptap\Core\Extension;

use InvalidArgumentException;

/**
 * Runtime server-side editor context — not persisted project config.
 */
class EditorConfig extends Model
{
    // Constants
    // =========================================================================

    public const DEFAULT_MAX_NODES = 10000;
    public const DEFAULT_MAX_DEPTH = 32;
    public const DEFAULT_MAX_BYTES = 524288;

    private const ENDPOINTS = ['upload', 'mentions', 'elements'];


    // Properties
    // =========================================================================

    public string $handle = '';
    public array $features = [];
    public ?string $placeholder = null;
    public array $labels = [];
    public array $extensions = [];
    public ?AssetConfig $assets = null;
    public ?ElementLinkConfig $elementLinks = null;
    public ?MentionConfig $mentions = null;
    public ?GifConfig $gifs = null;
    public AssetResolverInterface|AssetUploaderInterface|null $assetProvider = null;
    public ?ElementProviderInterface $elementProvider = null;
    public ?MentionProviderInterface $mentionProvider = null;
    public array $referenceContext = [];
    public mixed $authorize = null;
    public mixed $resolveScope = null;
    public bool $requireViewPermission = false;
    public int $maxNodes = self::DEFAULT_MAX_NODES;
    public int $maxDepth = self::DEFAULT_MAX_DEPTH;
    public int $maxBytes = self::DEFAULT_MAX_BYTES;


    // Public Methods
    // =========================================================================

    /**
     * The one feature rule shared by the sanitiser, uploads and resolution: the flag is on and, for
     * features backed by a Craft resource, its capability is configured and enabled.
     */
    public function isEnabled(Feature $feature): bool
    {
        $value = $this->features[$feature->value] ?? false;

        if (is_array($value) ? $value === [] : !$value) {
            return false;
        }

        return match ($feature) {
            Feature::Mention => $this->mentions?->enabled ?? false,
            Feature::Image, Feature::Attachment => $this->assets?->enabled ?? false,
            Feature::CraftLink => $this->elementLinks?->enabled ?? false,
            default => true,
        };
    }

    public function getHeadingLevels(): array
    {
        $headings = $this->features[Feature::Headings->value] ?? false;

        if ($headings === true) {
            return [2, 3];
        }

        if (!is_array($headings)) {
            return [];
        }

        // Unregistered contexts skip validation, so this drops what the browser would drop too.
        return array_values(array_unique(array_filter($headings, static fn(mixed $level): bool => is_int($level) && $level >= 1 && $level <= 6)));
    }

    /**
     * With no `$authorize` callable, any logged-in user may use the context's resources.
     */
    public function authorizeUser(User $user, Capability $capability): bool
    {
        return !is_callable($this->authorize) || (bool)($this->authorize)($user, $capability->value, $this);
    }

    public function getMentionProvider(): MentionProviderInterface
    {
        return $this->mentionProvider ?? new UserMentionProvider();
    }

    public function getElementProvider(): ElementProviderInterface
    {
        return $this->elementProvider ?? new CraftElementProvider();
    }

    public function getAssetResolver(): AssetResolverInterface
    {
        return $this->assetProvider instanceof AssetResolverInterface ? $this->assetProvider : new CraftAssetProvider();
    }

    public function getAssetUploader(): AssetUploaderInterface
    {
        return $this->assetProvider instanceof AssetUploaderInterface ? $this->assetProvider : new CraftAssetProvider();
    }

    /**
     * Everything `new Editor(element, options)` and `<verbb-editor>` need for this context, so
     * features, endpoints, upload limits and strings are never repeated by hand. Pass `$scope` for
     * what the endpoints should validate through `$resolveScope`, such as the thread being replied
     * to; the browser returns it unread.
     *
     * Pass `$endpoints` to send an enabled feature's requests to your own controller instead, such as
     * `['mentions' => UrlHelper::actionUrl('my-plugin/mentions')]`, which then calls Editor's services
     * itself. Endpoints the context doesn't use stay out.
     *
     * Resource endpoints stay authenticated, so guests get basic editing and no endpoints.
     */
    public function browserOptions(?array $scope = null, array $endpoints = []): array
    {
        foreach ($endpoints as $name => $url) {
            if (!in_array($name, self::ENDPOINTS, true) || !is_string($url) || $url === '') {
                throw new InvalidArgumentException('Editor endpoints are `upload`, `mentions` and `elements`, each with a URL.');
            }
        }

        $user = Craft::$app->getUser()->getIdentity();
        $features = [];

        foreach (Feature::cases() as $feature) {
            $enabled = $this->isEnabled($feature);

            if (!$user && in_array($feature, [Feature::Mention, Feature::Image, Feature::Attachment, Feature::CraftLink], true)) {
                $enabled = false;
            }

            $features[$feature->value] = $enabled;
        }

        $levels = $this->getHeadingLevels();
        $features[Feature::Headings->value] = $levels !== [] ? $levels : false;

        $options = [
            'features' => $features,
            'placeholder' => $this->placeholder,
            'labels' => array_merge(Labels::all(), $this->labels),
            'craft' => $user ? $this->_browserResources($features, $scope, $endpoints) : false,
        ];

        // GIPHY's key is its public web key and GIF search runs in the browser, so guests get it too.
        $gifs = $this->gifs?->browserOptions(Craft::$app->language);

        if ($gifs !== null) {
            $options['gifs'] = $gifs;
        }

        // In the Control Panel the editor takes Craft's own colours. On the front end the host's
        // `theme` attribute or tokens decide.
        if (Craft::$app->getRequest()->getIsCpRequest()) {
            $options['theme'] = 'craft';
        }

        return $options;
    }


    public function validateFeatures(string $attribute): void
    {
        foreach ($this->features as $key => $value) {
            if (Feature::tryFrom((string)$key) === null) {
                $this->addError($attribute, "Unknown Editor feature `{$key}`.");
            }
        }

        $headings = $this->features[Feature::Headings->value] ?? false;

        if (is_array($headings) && array_filter($headings, static fn(mixed $level): bool => !is_int($level) || $level < 1 || $level > 6)) {
            $this->addError($attribute, 'Heading levels must be integers from 1 to 6.');
        }
    }

    public function validateExtensions(string $attribute): void
    {
        foreach ($this->extensions as $extension) {
            if (!$extension instanceof Extension) {
                $this->addError($attribute, 'Server extensions must be Tiptap PHP extensions.');
            }
        }
    }

    public function validateCallable(string $attribute): void
    {
        if ($this->$attribute !== null && !is_callable($this->$attribute)) {
            $this->addError($attribute, "`{$attribute}` must be callable.");
        }
    }

    public function validateCapability(string $attribute): void
    {
        if ($this->$attribute !== null && !$this->$attribute->validate()) {
            $this->addError($attribute, implode(' ', $this->$attribute->getFirstErrors()));
        }
    }


    // Protected Methods
    // =========================================================================

    protected function defineRules(): array
    {
        $rules = parent::defineRules();

        $rules[] = [['handle'], 'required'];
        $rules[] = [['handle'], 'match', 'pattern' => '/^[a-z0-9-]+(\.[a-z0-9-]+)+$/', 'message' => '{attribute} must be a namespaced handle, such as `comments.reply`.'];
        $rules[] = [['maxNodes', 'maxDepth', 'maxBytes'], 'integer', 'min' => 1];
        $rules[] = [['features'], 'validateFeatures'];
        $rules[] = [['extensions'], 'validateExtensions'];
        $rules[] = [['authorize', 'resolveScope'], 'validateCallable'];
        $rules[] = [['assets', 'elementLinks', 'mentions', 'gifs'], 'validateCapability'];

        return $rules;
    }


    // Private Methods
    // =========================================================================

    private function _browserResources(array $features, ?array $scope, array $overrides): array
    {
        $generalConfig = Craft::$app->getConfig()->getGeneral();
        $endpoints = [];

        if ($features[Feature::Image->value] || $features[Feature::Attachment->value]) {
            $endpoints['upload'] = UrlHelper::actionUrl('verbb-editor/assets/upload');
        }

        if ($features[Feature::Mention->value]) {
            $endpoints['mentions'] = UrlHelper::actionUrl('verbb-editor/mentions/search');
        }

        if ($features[Feature::CraftLink->value]) {
            $endpoints['elements'] = UrlHelper::actionUrl('verbb-editor/elements/search');
        }

        // An override replaces a URL but never adds an endpoint the context's features don't use.
        $endpoints = array_replace($endpoints, array_intersect_key($overrides, $endpoints));

        $resources = [
            'context' => $this->handle,
            'endpoints' => $endpoints,
            'csrfTokenName' => $generalConfig->csrfTokenName,
            'csrfToken' => $generalConfig->enableCsrfProtection && !Craft::$app->getRequest()->getIsConsoleRequest() ? Craft::$app->getRequest()->getCsrfToken() : false,
        ];

        if ($scope !== null) {
            $resources['scope'] = $scope;
        }

        if ($this->assets !== null && isset($endpoints['upload'])) {
            $resources['uploads'] = $this->assets->browserLimits();
        }

        if ($this->mentions !== null) {
            $resources['minQueryLength'] = $this->mentions->minQueryLength;
        }

        return $resources;
    }
}
