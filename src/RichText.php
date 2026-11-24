<?php
namespace verbb\editor;

use verbb\editor\helpers\Normalizer;
use verbb\editor\helpers\PlainText;
use verbb\editor\helpers\References;
use verbb\editor\helpers\Sanitizer;
use verbb\editor\helpers\Tiptap;
use verbb\editor\models\EditorConfig;

use craft\helpers\Json;

use yii\base\InvalidArgumentException;

use JsonSerializable;
use Stringable;

class RichText implements JsonSerializable, Stringable
{
    // Static Methods
    // =========================================================================

    /**
     * Takes a RichText, an array, or a string. A string is a document only if it decodes to one;
     * any other string is literal text, and HTML is never guessed. See `fromHtml()` for that.
     */
    public static function from(mixed $value = null): self
    {
        return $value instanceof self ? $value : new self($value);
    }

    /**
     * Unlike `from()`, a JSON string here is expected to be a document, so anything else is an error.
     */
    public static function fromJson(string $json): self
    {
        if ($json === '') {
            return new self();
        }

        $document = Normalizer::decodeDocument($json);

        if ($document === null && json_decode($json) !== []) {
            throw new InvalidArgumentException('The JSON string is not an Editor document.');
        }

        return new self($document);
    }

    /**
     * Extensions come from the context, so its custom nodes and marks can be imported.
     */
    public static function fromHtml(string $html, ?EditorConfig $config = null): self
    {
        return new self(Tiptap::htmlToContent($html, $config?->extensions ?? []));
    }

    public static function fromText(string $text): self
    {
        return new self(Normalizer::textToContent($text));
    }


    // Properties
    // =========================================================================

    private array $_value = [];


    // Public Methods
    // =========================================================================

    public function __construct(mixed $value = null)
    {
        $this->setValue($value);
    }

    public function __toString(): string
    {
        return $this->toPlainText();
    }

    public function setValue(mixed $value): void
    {
        $this->_value = Normalizer::normalize($value);
    }

    public function isEmpty(): bool
    {
        return Normalizer::isEmptyContent($this->_value);
    }

    public function getValue(): array
    {
        return $this->_value;
    }

    public function getSchema(): array
    {
        return $this->_value;
    }

    public function toDoc(): array
    {
        return [
            'type' => 'doc',
            'content' => $this->_value,
        ];
    }

    /**
     * An empty document serialises as a `doc` object, because `from()` reads the string `[]` as
     * literal text. Decoded empty arrays are still empty documents.
     */
    public function toJson(): string
    {
        return Json::encode($this->jsonSerialize());
    }

    /**
     * Renders without a context, so nothing can vouch for a reference and structured nodes fall
     * back to text. Use `Documents::toHtml()` with a context to render them.
     */
    public function toHtml(bool $nl2br = false): string
    {
        return Tiptap::contentToHtml(Sanitizer::degradeStructuredNodes(Sanitizer::sanitize($this->_value)), nl2br: $nl2br);
    }

    public function toPlainText(): string
    {
        return Normalizer::stripInvisibleChars(PlainText::render($this->_value));
    }

    /**
     * The number of characters the editor's `limit` counts, so a server-side limit can match it.
     * Image alt text and attachment filenames don't count.
     */
    public function getTextLength(): int
    {
        return PlainText::textLength($this->_value);
    }

    public function extractReferences(): array
    {
        return References::from($this->_value)->all();
    }

    public function extractMentions(): array
    {
        return References::from($this->_value)->mentions();
    }

    public function jsonSerialize(): array
    {
        return $this->_value === [] ? $this->toDoc() : $this->_value;
    }
}
