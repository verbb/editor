<?php
namespace verbb\editor\errors;

use yii\base\UserException;

/**
 * A submitted document exceeded a context's limits. Extends UserException because the message
 * is written for the author: controllers and consumers can show it as is.
 */
class DocumentLimitException extends UserException
{
}
