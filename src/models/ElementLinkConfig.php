<?php
namespace verbb\editor\models;

use craft\base\ElementInterface;
use craft\base\Model;

class ElementLinkConfig extends Model
{
    // Properties
    // =========================================================================

    public bool $enabled = false;
    public array $elementTypes = [];
    public array $siteIds = [];
    public array $criteria = [];
    public mixed $eligibility = null;
    /** `fn(ElementInterface $element, EditorConfig $context): ?string`, the line under a result. Defaults to its section, group or type. */
    public mixed $describe = null;
    public int $limit = 10;


    // Public Methods
    // =========================================================================

    public function validateElementTypes(string $attribute): void
    {
        foreach ($this->elementTypes as $elementType) {
            if (!is_string($elementType) || !is_subclass_of($elementType, ElementInterface::class)) {
                $this->addError($attribute, 'Each element type must be an element class.');
            }
        }
    }

    public function validateCriteria(string $attribute): void
    {
        foreach ($this->criteria as $elementType => $criteria) {
            if (!in_array($elementType, $this->elementTypes, true) || !is_array($criteria)) {
                $this->addError($attribute, "Criteria for `{$elementType}` needs a listed element type and an array.");
            }
        }
    }

    public function validateCallable(string $attribute): void
    {
        if ($this->$attribute !== null && !is_callable($this->$attribute)) {
            $this->addError($attribute, "`{$attribute}` must be callable.");
        }
    }


    // Protected Methods
    // =========================================================================

    protected function defineRules(): array
    {
        $rules = parent::defineRules();

        $rules[] = [['enabled'], 'boolean'];
        $rules[] = [['limit'], 'integer', 'min' => 1, 'max' => 50];
        $rules[] = [['elementTypes'], 'validateElementTypes'];
        $rules[] = [['criteria'], 'validateCriteria'];
        $rules[] = [['eligibility', 'describe'], 'validateCallable'];

        return $rules;
    }
}
