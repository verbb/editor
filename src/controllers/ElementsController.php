<?php
namespace verbb\editor\controllers;

use verbb\editor\Editor;
use verbb\editor\enums\Capability;
use verbb\editor\models\EditorConfig;

use yii\web\Response;

class ElementsController extends BaseController
{
    // Public Methods
    // =========================================================================

    public function actionSearch(): Response
    {
        $this->requirePostRequest();
        $this->requireAcceptsJson();

        return $this->handle(Capability::Elements, function(EditorConfig $config): array {
            return ['results' => Editor::$plugin->getElements()->search($this->resolveQuery(), $config)];
        });
    }
}
