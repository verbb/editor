<?php
namespace verbb\editor\controllers;

use verbb\editor\Editor;
use verbb\editor\enums\Capability;
use verbb\editor\models\EditorConfig;

use Craft;

use yii\web\BadRequestHttpException;
use yii\web\Response;
use yii\web\UploadedFile;

class AssetsController extends BaseController
{
    // Public Methods
    // =========================================================================

    public function actionUpload(): Response
    {
        $this->requirePostRequest();
        $this->requireAcceptsJson();

        return $this->handle(Capability::Upload, function(EditorConfig $config): array {
            $file = UploadedFile::getInstanceByName('file');

            if (!$file) {
                throw new BadRequestHttpException(Craft::t('editor', 'No file was uploaded.'));
            }

            $kind = $this->request->getBodyParam('kind', 'inlineImage');

            if (!is_string($kind)) {
                throw new BadRequestHttpException(Craft::t('editor', 'Unsupported upload kind.'));
            }

            return ['asset' => Editor::$plugin->getAssets()->upload($file, $config, $kind)];
        });
    }
}
