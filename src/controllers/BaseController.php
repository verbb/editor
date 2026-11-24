<?php
namespace verbb\editor\controllers;

use verbb\editor\Editor;
use verbb\editor\enums\Capability;
use verbb\editor\models\EditorConfig;

use Craft;
use craft\web\Controller;

use yii\base\UserException;
use yii\web\BadRequestHttpException;
use yii\web\HttpException;
use yii\web\Response;

use Throwable;

abstract class BaseController extends Controller
{
    // Constants
    // =========================================================================

    private const MAX_QUERY_LENGTH = 200;


    // Properties
    // =========================================================================

    protected array|bool|int $allowAnonymous = self::ALLOW_ANONYMOUS_NEVER;


    // Protected Methods
    // =========================================================================

    /**
     * Runs an action with the request's context, and turns failures into Craft's response envelope.
     * Refusals written for the author pass through; anything else is logged and stays generic.
     */
    protected function handle(Capability $capability, callable $action): Response
    {
        try {
            return $this->asSuccess(data: $action($this->resolveConfig($capability)));
        } catch (UserException $e) {
            $status = $e instanceof HttpException && $e->statusCode >= 400 && $e->statusCode < 500 ? $e->statusCode : 400;

            return $this->asFailure($e->getMessage())->setStatusCode($status);
        } catch (Throwable $e) {
            Editor::error('Editor resource request failed: ' . $e->getMessage());

            return $this->asFailure(Craft::t('editor', 'The Editor resource request could not be processed.'))->setStatusCode(500);
        }
    }

    protected function resolveQuery(): string
    {
        $query = $this->request->getBodyParam('query', '');

        if (!is_string($query) || mb_strlen(trim($query)) > self::MAX_QUERY_LENGTH) {
            throw new BadRequestHttpException(Craft::t('editor', 'The search is too long.'));
        }

        return trim($query);
    }

    /**
     * The request's context, with its scope checked and the capability authorised for the user.
     */
    protected function resolveConfig(Capability $capability): EditorConfig
    {
        return Editor::$plugin->getEditorConfigs()->resolveRequestConfig(
            $this->request->getRequiredBodyParam('context'),
            $this->request->getBodyParam('scope', []),
            Craft::$app->getUser()->getIdentity(),
            $capability,
        );
    }
}
