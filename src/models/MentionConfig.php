<?php
namespace verbb\editor\models;

use craft\base\Model;

/**
 * Who can be mentioned is always a deliberate choice: `$criteria` holds trusted User query
 * criteria (`[]` means every active user), and `$eligibleIds` narrows them per request. With
 * neither set, nobody is eligible. When `$eligibleIds` names the people in a conversation, an empty
 * search suggests them before the author types a name.
 */
class MentionConfig extends Model
{
    // Properties
    // =========================================================================

    public bool $enabled = false;
    public int $minQueryLength = 2;
    public int $limit = 10;
    public ?array $criteria = null;
    public mixed $eligibleIds = null;
    /** `fn(User $user, array $referenceContext, EditorConfig $context): ?string`, a role or activity line under the name. */
    public mixed $describe = null;


    // Public Methods
    // =========================================================================

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
        $rules[] = [['minQueryLength'], 'integer', 'min' => 1];
        $rules[] = [['limit'], 'integer', 'min' => 1, 'max' => 50];
        $rules[] = [['eligibleIds', 'describe'], 'validateCallable'];

        return $rules;
    }
}
