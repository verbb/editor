<?php
namespace verbb\editor\errors;

use yii\web\BadRequestHttpException;

/**
 * An upload `UploadSafety` won't accept. The message is written for the uploader, and `$reason` says why
 * as one of the `REASON_*` constants, so a plugin can show its own message or map it to its own error
 * codes. It's a bad request, as Editor's other upload refusals are.
 */
class UploadRefusedException extends BadRequestHttpException
{
    // Constants
    // =========================================================================

    /** The upload's temporary file is missing. */
    public const REASON_UPLOAD_FAILED = 'upload_failed';

    /** A type that's never accepted, such as SVG, HTML or a script, by its name or its contents. */
    public const REASON_FILE_TYPE = 'file_type';

    /** The file's type couldn't be read from its contents. */
    public const REASON_UNKNOWN_TYPE = 'unknown_type';

    /** The file's contents aren't what its extension says. */
    public const REASON_MISMATCH = 'mismatch';

    /** A TIFF image, which is always refused. */
    public const REASON_TIFF = 'tiff';

    /** A HEIC or AVIF image on a server without ImageMagick to remove its metadata. */
    public const REASON_NEEDS_IMAGICK = 'needs_imagick';

    /** An image that can't be read, so it can't be checked. */
    public const REASON_INVALID_IMAGE = 'invalid_image';

    /** An image whose metadata couldn't be removed. */
    public const REASON_METADATA = 'metadata';

    /** Craft's temporary upload filesystem has public URLs, so no upload is accepted. */
    public const REASON_TEMPORARY_UPLOADS_PUBLIC = 'temporary_uploads_public';


    // Public Methods
    // =========================================================================

    public function __construct(string $message, public readonly string $reason)
    {
        parent::__construct($message);
    }
}
