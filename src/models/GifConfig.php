<?php
namespace verbb\editor\models;

use craft\base\Model;

/**
 * GIF search through GIPHY. GIPHY's API terms have each visitor's browser search GIPHY directly, so
 * the key is GIPHY's key for the web and goes to the page for anyone who can use the editor. The GIF
 * someone chooses goes with the document rather than inside it, so the host decides where it's kept
 * and checks it with `Giphy::normalize()` before saving it.
 */
class GifConfig extends Model
{
    // Constants
    // =========================================================================

    public const RATINGS = ['g', 'pg', 'pg-13', 'r'];


    // Properties
    // =========================================================================

    public bool $enabled = true;
    public ?string $apiKey = null;
    public string $rating = 'g';
    public int $limit = 24;
    /** A two-letter language for searches, such as `fr`. Null uses the site's language. */
    public ?string $language = null;


    // Public Methods
    // =========================================================================

    /**
     * What the browser's GIF search needs, or null when it's off or has no key.
     */
    public function browserOptions(string $siteLanguage = 'en'): ?array
    {
        if (!$this->enabled || $this->apiKey === null || $this->apiKey === '') {
            return null;
        }

        return [
            'apiKey' => $this->apiKey,
            'rating' => $this->rating,
            'limit' => $this->limit,
            // GIPHY takes a two-letter language for searches in other languages.
            'language' => strtolower(substr($this->language ?? $siteLanguage, 0, 2)),
        ];
    }


    // Protected Methods
    // =========================================================================

    protected function defineRules(): array
    {
        $rules = parent::defineRules();

        $rules[] = [['enabled'], 'boolean'];
        $rules[] = [['rating'], 'in', 'range' => self::RATINGS];
        $rules[] = [['limit'], 'integer', 'min' => 1, 'max' => 50];
        $rules[] = [['apiKey', 'language'], 'string'];

        return $rules;
    }
}
