<?php
namespace verbb\editor\base;

use verbb\editor\enums\AssetKind;
use verbb\editor\models\AssetConfig;
use verbb\editor\models\EditorConfig;

use yii\web\UploadedFile;

interface AssetUploaderInterface
{
    // Public Methods
    // =========================================================================

    public function upload(UploadedFile $file, AssetConfig $config, EditorConfig $context, AssetKind $kind): array;
    public function finalize(array $references, ?AssetConfig $config, EditorConfig $context, int $actorId, array $associatedAssetIds = []): array;
}
