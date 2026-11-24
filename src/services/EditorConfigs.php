<?php
namespace verbb\editor\services;

use verbb\editor\enums\Capability;
use verbb\editor\errors\EditorConfigNotFoundException;
use verbb\editor\models\EditorConfig;

use Craft;
use craft\base\Component;
use craft\elements\User;
use craft\helpers\Json;

use yii\base\InvalidArgumentException;
use yii\base\InvalidConfigException;
use yii\web\BadRequestHttpException;
use yii\web\ForbiddenHttpException;
use yii\web\NotFoundHttpException;

class EditorConfigs extends Component
{
    // Constants
    // =========================================================================

    private const MAX_SCOPE_BYTES = 4096;


    // Properties
    // =========================================================================

    private array $_configs = [];


    // Public Methods
    // =========================================================================

    /**
     * A duplicate is almost always two plugins claiming one handle, so it throws unless the caller
     * says it means to replace it, as a consumer does when its settings change mid-request.
     */
    public function registerConfig(EditorConfig $config, bool $replace = false): void
    {
        if (!$config->validate()) {
            throw new InvalidConfigException("Invalid Editor context `{$config->handle}`: " . implode(' ', $config->getFirstErrors()));
        }

        if (!$replace && isset($this->_configs[$config->handle])) {
            throw new InvalidConfigException("Editor context `{$config->handle}` is already registered.");
        }

        $this->_configs[$config->handle] = $config;
    }

    public function getConfigByHandle(string $handle): ?EditorConfig
    {
        return $this->_configs[$handle] ?? null;
    }

    /**
     * Resolve a trusted server-side context or fail explicitly.
     */
    public function requireConfigByHandle(string $handle): EditorConfig
    {
        return $this->getConfigByHandle($handle) ?? throw new EditorConfigNotFoundException($handle);
    }

    public function getAllConfigs(): array
    {
        return $this->_configs;
    }

    /**
     * The context for one mention, page search or upload request, with its scope checked and its
     * capability authorised for `$user`. Editor's endpoints use this, and so should a consumer's own
     * controller standing in for them, so every route makes the same checks. `$handle` and `$scope`
     * are the request's `context` and `scope` exactly as sent. The handle only names trusted server
     * configuration and grants nothing by itself.
     *
     * Throws an HTTP exception whose message is safe to show the author.
     */
    public function resolveRequestConfig(mixed $handle, mixed $scope, ?User $user, Capability $capability): EditorConfig
    {
        try {
            // A JSON body can hold anything here, and only a string can name a context.
            $config = $this->requireConfigByHandle(is_string($handle) ? $handle : '');
        } catch (EditorConfigNotFoundException) {
            throw new NotFoundHttpException(Craft::t('editor', 'This editor is no longer available.'));
        }

        // Craft lets a valid site token past its anonymous check, but these requests stay authenticated.
        if (!$user) {
            throw new ForbiddenHttpException(Craft::t('editor', 'You can’t use this editor here.'));
        }

        // Clone, so a request's scope can't leak into the registered context.
        $config = clone $config;

        // `referenceContext` only ever holds what the consumer's callable returned, so providers can
        // trust it. Without a callable the client's scope is ignored rather than copied in.
        if (is_callable($config->resolveScope)) {
            $referenceContext = ($config->resolveScope)($this->_requestScope($scope), $user, $config);

            if (!is_array($referenceContext)) {
                throw new ForbiddenHttpException(Craft::t('editor', 'You can’t use this editor here.'));
            }

            $config->referenceContext = $referenceContext;
        }

        if (!$config->authorizeUser($user, $capability)) {
            throw new ForbiddenHttpException(Craft::t('editor', 'You can’t use this editor here.'));
        }

        return $config;
    }


    // Private Methods
    // =========================================================================

    private function _requestScope(mixed $scope): array
    {
        // Uploads are multipart, so their scope arrives as a JSON string.
        if (is_string($scope)) {
            if (strlen($scope) > self::MAX_SCOPE_BYTES) {
                throw new BadRequestHttpException(Craft::t('editor', 'The editor scope is invalid.'));
            }

            try {
                $scope = $scope === '' ? [] : Json::decode($scope);
            } catch (InvalidArgumentException) {
                throw new BadRequestHttpException(Craft::t('editor', 'The editor scope is invalid.'));
            }
        }

        if (!is_array($scope) || strlen(Json::encode($scope)) > self::MAX_SCOPE_BYTES) {
            throw new BadRequestHttpException(Craft::t('editor', 'The editor scope is invalid.'));
        }

        return $scope;
    }
}
