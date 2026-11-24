<?php
namespace verbb\editor\controllers;

use verbb\editor\Editor;
use verbb\editor\enums\Capability;
use verbb\editor\models\EditorConfig;

use yii\web\Response;

class MentionsController extends BaseController
{
    // Public Methods
    // =========================================================================

    public function actionSearch(): Response
    {
        $this->requirePostRequest();
        $this->requireAcceptsJson();

        return $this->handle(Capability::Mentions, function(EditorConfig $config): array {
            return ['results' => Editor::$plugin->getMentions()->search($this->resolveQuery(), $config)];
        });
    }
}
