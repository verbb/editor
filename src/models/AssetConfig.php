<?php
namespace verbb\editor\models;

use verbb\editor\enums\AssetKind;
use verbb\editor\helpers\UploadSafety;

use Craft;
use craft\base\Model;
use craft\helpers\ConfigHelper;

class AssetConfig extends Model
{
    // Constants
    // =========================================================================

    public const DEFAULT_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];


    // Properties
    // =========================================================================

    public bool $enabled = false;
    public ?int $volumeId = null;
    public ?int $folderId = null;
    public array $allowedExtensions = [];
    public ?int $maxFileSize = null;
    public ?int $maxImages = null;
    public ?int $maxAttachments = null;


    // Public Methods
    // =========================================================================

    /**
     * Images have a safe default. Attachments have none, so a context must name what it accepts.
     */
    public function getAllowedExtensions(AssetKind $kind): array
    {
        $extensions = array_map('strtolower', $this->allowedExtensions);

        if ($extensions === [] && $kind === AssetKind::InlineImage) {
            return self::DEFAULT_IMAGE_EXTENSIONS;
        }

        // Never offered, since every upload refuses them whatever is listed. Filtered after the default,
        // so a list of only those allows nothing rather than the default images.
        return array_values(array_filter($extensions, static fn(string $extension): bool => !UploadSafety::isBlockedExtension($extension)));
    }

    /**
     * A context can lower Craft's upload limit but never raise it.
     */
    public function getMaxFileSize(): int
    {
        $craftLimit = (int)ConfigHelper::sizeInBytes(Craft::$app->getConfig()->getGeneral()->maxUploadFileSize);

        return $this->maxFileSize !== null ? min($this->maxFileSize, $craftLimit) : $craftLimit;
    }

    public function browserLimits(): array
    {
        return [
            'imageExtensions' => $this->getAllowedExtensions(AssetKind::InlineImage),
            'attachmentExtensions' => $this->getAllowedExtensions(AssetKind::Attachment),
            'maxFileSize' => $this->getMaxFileSize(),
            'maxImages' => $this->maxImages,
            'maxAttachments' => $this->maxAttachments,
        ];
    }


    // Protected Methods
    // =========================================================================

    protected function defineRules(): array
    {
        $rules = parent::defineRules();

        $rules[] = [['enabled'], 'boolean'];
        $rules[] = [['volumeId', 'folderId', 'maxFileSize', 'maxImages', 'maxAttachments'], 'integer', 'min' => 1];
        $rules[] = [['allowedExtensions'], 'each', 'rule' => ['string']];

        return $rules;
    }
}
