<?php
namespace verbb\editor\integrations\mentions;

use verbb\editor\Editor;
use verbb\editor\base\MentionProviderInterface;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\MentionConfig;

use Craft;
use craft\elements\db\OrderByPlaceholderExpression;
use craft\elements\db\UserQuery;
use craft\elements\User;

use Throwable;

/**
 * Mentions of Craft users, scoped by the context rather than by the viewer's Control Panel
 * permissions, so guests and members see what authors wrote.
 */
class UserMentionProvider implements MentionProviderInterface
{
    // Constants
    // =========================================================================

    private const MAX_SEARCH_PAGES = 5;


    // Public Methods
    // =========================================================================

    public function search(string $query, MentionConfig $config, EditorConfig $context): array
    {
        $query = trim($query);

        // Guests can't enumerate users through Editor endpoints.
        if (!$config->enabled || Craft::$app->getUser()->getIsGuest()) {
            return [];
        }

        // An empty query suggests people only when the consumer named who's eligible here, such as
        // the people in a thread. Criteria alone can cover a whole user base, so they need a name.
        if ($query === '') {
            return is_callable($config->eligibleIds) ? $this->_suggestions($config, $context) : [];
        }

        if (mb_strlen($query) < $config->minQueryLength) {
            return [];
        }

        $users = $this->_eligibleUsers($config, $context);

        if ($users === null) {
            return [];
        }

        // Search name fields directly: Craft's search index also covers email addresses.
        $nameMatches = [
            'or',
            ['like', 'users.fullName', $query],
            ['like', 'users.firstName', $query],
            ['like', 'users.lastName', $query],
        ];

        if (!Craft::$app->getConfig()->getGeneral()->useEmailAsUsername) {
            $nameMatches[] = ['and', ['like', 'users.username', $query], ['not like', 'users.username', '@']];
        }

        $users->andWhere($nameMatches);

        // Craft's default user order leaves active users tied, and offset paging needs a stable order.
        if (is_array($users->orderBy) && count($users->orderBy) === 1 && ($users->orderBy[0] ?? null) instanceof OrderByPlaceholderExpression) {
            $users->orderBy(['users.fullName' => SORT_ASC, 'elements.id' => SORT_ASC]);
        }

        $results = [];

        // Some checks only run in PHP, so page through matches rather than returning a short list
        // because the first page happened to be filtered out.
        for ($page = 0; $page < self::MAX_SEARCH_PAGES; $page++) {
            $matches = (clone $users)->offset($page * $config->limit)->limit($config->limit)->all();

            foreach ($matches as $user) {
                /** @var User $user */
                $label = $this->_label($user);

                if ($label !== null && $this->_canShow($user, $context)) {
                    $results[] = $this->_result($user, $label, $config, $context);

                    if (count($results) >= $config->limit) {
                        return $results;
                    }
                }
            }

            if (count($matches) < $config->limit) {
                break;
            }
        }

        return $results;
    }

    public function resolve(array $reference, MentionConfig $config, EditorConfig $context): ?array
    {
        return $this->resolveAll(['reference' => $reference], $config, $context)['reference'] ?? null;
    }

    public function resolveAll(array $references, MentionConfig $config, EditorConfig $context): array
    {
        $ids = [];

        foreach ($references as $reference) {
            $id = (int)($reference['id'] ?? 0);

            if ($id > 0 && ($reference['type'] ?? null) === User::class) {
                $ids[$id] = $id;
            }
        }

        $users = $ids !== [] ? $this->_eligibleUsers($config, $context) : null;

        if ($users === null) {
            return [];
        }

        $found = $users->andWhere(['elements.id' => array_values($ids)])->indexBy('id')->all();
        $resolved = [];

        foreach ($references as $key => $reference) {
            $user = ($reference['type'] ?? null) === User::class ? ($found[(int)($reference['id'] ?? 0)] ?? null) : null;

            if ($user instanceof User && $this->_canShow($user, $context)) {
                $resolved[$key] = [
                    'id' => (int)$user->id,
                    'type' => User::class,
                    'label' => $this->_label($user) ?? (string)($reference['label'] ?? ''),
                ];
            }
        }

        return $resolved;
    }


    // Private Methods
    // =========================================================================

    private function _suggestions(MentionConfig $config, EditorConfig $context): array
    {
        $users = $this->_eligibleUsers($config, $context);

        if ($users === null) {
            return [];
        }

        $users->orderBy(['users.fullName' => SORT_ASC, 'elements.id' => SORT_ASC])->limit($config->limit);
        $results = [];

        foreach ($users->all() as $user) {
            /** @var User $user */
            $label = $this->_label($user);

            if ($label !== null && $this->_canShow($user, $context)) {
                $results[] = $this->_result($user, $label, $config, $context);
            }
        }

        return $results;
    }

    /**
     * A search result, with the optional role line and avatar the editor shows. Only `id`, `type`
     * and `label` are ever stored.
     */
    private function _result(User $user, string $label, MentionConfig $config, EditorConfig $context): array
    {
        $result = ['id' => (int)$user->id, 'type' => User::class, 'label' => $label];
        $description = is_callable($config->describe) ? ($config->describe)($user, $context->referenceContext, $context) : null;

        if (is_string($description) && trim($description) !== '') {
            $result['description'] = trim($description);
        }

        $imageUrl = $this->_imageUrl($user);

        if ($imageUrl !== null) {
            $result['imageUrl'] = $imageUrl;
        }

        return $result;
    }

    /**
     * A small transform of the user's photo, when its volume has public URLs. Without one there's no
     * address a site visitor could load, so the editor shows initials.
     */
    private function _imageUrl(User $user): ?string
    {
        if (!$user->photoId) {
            return null;
        }

        try {
            return $user->getPhoto()?->getUrl(['width' => 64, 'height' => 64, 'mode' => 'crop']) ?: null;
        } catch (Throwable $e) {
            Editor::error('Editor couldn’t make a mention avatar URL: ' . $e->getMessage());

            return null;
        }
    }

    private function _eligibleUsers(MentionConfig $config, EditorConfig $context): ?UserQuery
    {
        $hasCallable = is_callable($config->eligibleIds);

        if ($config->criteria === null && !$hasCallable) {
            return null;
        }

        $query = User::find();
        Craft::configure($query, $config->criteria ?? []);
        // Set after the criteria, so a consumer's criteria can't widen this to inactive users.
        $query->status(User::STATUS_ACTIVE);

        if ($hasCallable) {
            $ids = ($config->eligibleIds)($context->referenceContext, $context);
            $ids = is_array($ids) ? array_values(array_unique(array_map('intval', $ids))) : [];

            if ($ids === []) {
                return null;
            }

            $query->andWhere(['elements.id' => $ids]);
        }

        return $query;
    }

    private function _canShow(User $user, EditorConfig $context): bool
    {
        return !$context->requireViewPermission || Craft::$app->getElements()->canView($user);
    }

    /**
     * Never publishes a username holding an email address (`useEmailAsUsername`).
     */
    private function _label(User $user): ?string
    {
        $name = trim((string)$user->fullName) ?: trim($user->firstName . ' ' . $user->lastName);

        if ($name !== '') {
            return $name;
        }

        return str_contains((string)$user->username, '@') ? null : ($user->username ?: null);
    }
}
