<?php
namespace verbb\editor\integrations\elements;

use verbb\editor\base\ElementProviderInterface;
use verbb\editor\models\EditorConfig;
use verbb\editor\models\ElementLinkConfig;

use Craft;
use craft\base\ElementInterface;
use craft\elements\Category;
use craft\elements\Entry;
use craft\elements\db\ElementQueryInterface;

/**
 * Craft element links, scoped by the context's trusted criteria rather than by the viewer's
 * Control Panel permissions, so guests and members can follow what authors linked.
 */
class CraftElementProvider implements ElementProviderInterface
{
    // Constants
    // =========================================================================

    private const MAX_SEARCH_PAGES = 5;


    // Public Methods
    // =========================================================================

    public function search(string $query, ElementLinkConfig $config, EditorConfig $context): array
    {
        $query = trim($query);

        // Guests can't discover content through Editor endpoints.
        if (!$config->enabled || $config->elementTypes === [] || Craft::$app->getUser()->getIsGuest()) {
            return [];
        }

        // An empty query suggests pages in each type's own order, such as the newest entries first.
        // One character would match almost everything, so it waits for more.
        if ($query !== '' && mb_strlen($query) < 2) {
            return [];
        }

        $results = [];

        foreach ($config->elementTypes as $elementType) {
            // Eligibility can only be checked in PHP, so page through matches rather than
            // returning a short list because the first page happened to be ineligible.
            for ($page = 0; $page < self::MAX_SEARCH_PAGES; $page++) {
                $elementQuery = $this->_query($elementType, $config);

                if ($query !== '') {
                    $elementQuery->search($query);
                }

                $elements = $elementQuery
                    ->offset($page * $config->limit)
                    ->limit($config->limit)
                    ->all();

                foreach ($elements as $element) {
                    if (!$this->_isEligible($element, $config, $context) || !$element->getUrl()) {
                        continue;
                    }

                    $results[] = $this->_searchResult($element, $config, $context);

                    if (count($results) >= $config->limit) {
                        return $results;
                    }
                }

                if (count($elements) < $config->limit) {
                    break;
                }
            }
        }

        return $results;
    }

    public function resolve(array $reference, ElementLinkConfig $config, EditorConfig $context): ?array
    {
        return $this->resolveAll(['reference' => $reference], $config, $context)['reference'] ?? null;
    }

    public function resolveAll(array $references, ElementLinkConfig $config, EditorConfig $context): array
    {
        $idsByType = [];

        foreach ($references as $reference) {
            $id = (int)($reference['id'] ?? 0);
            $type = (string)($reference['type'] ?? '');

            if ($id > 0 && in_array($type, $config->elementTypes, true)) {
                $idsByType[$type][$id] = $id;
            }
        }

        $found = [];

        foreach ($idsByType as $type => $ids) {
            $found[$type] = $this->_query($type, $config)->id(array_values($ids))->indexBy('id')->all();
        }

        $resolved = [];

        foreach ($references as $key => $reference) {
            $element = $found[$reference['type'] ?? ''][(int)($reference['id'] ?? 0)] ?? null;

            if ($element instanceof ElementInterface && $this->_isEligible($element, $config, $context) && $element->getUrl()) {
                $resolved[$key] = $this->_serializeElement($element);
            }
        }

        return $resolved;
    }


    // Private Methods
    // =========================================================================

    /**
     * A search result, with the line the editor shows under it. Only `id`, `type` and `label` are
     * ever stored; `url` is resolved again whenever the document renders.
     */
    private function _searchResult(ElementInterface $element, ElementLinkConfig $config, EditorConfig $context): array
    {
        $result = $this->_serializeElement($element);
        $description = is_callable($config->describe) ? ($config->describe)($element, $context) : $this->_defaultDescription($element);

        if (is_string($description) && trim($description) !== '') {
            $result['description'] = trim($description);
        }

        return $result;
    }

    private function _defaultDescription(ElementInterface $element): ?string
    {
        if ($element instanceof Entry) {
            return $element->getSection()?->name ?? $element::displayName();
        }

        if ($element instanceof Category) {
            return $element->getGroup()->name;
        }

        return $element::displayName();
    }

    private function _serializeElement(ElementInterface $element): array
    {
        return [
            'id' => (int)$element->id,
            'type' => get_class($element),
            'label' => (string)$element,
            'url' => $element->getUrl(),
        ];
    }

    private function _query(string $elementType, ElementLinkConfig $config): ElementQueryInterface
    {
        /** @var ElementQueryInterface $query */
        $query = $elementType::find();

        // Only live content by default; elements without that status use their query's default.
        if (array_key_exists('live', $elementType::statuses())) {
            $query->status('live');
        }

        if ($config->siteIds !== []) {
            $query->siteId(array_values(array_unique(array_map('intval', $config->siteIds))));
        }

        // Applied last, because these are the consumer's trusted choices and may set a status.
        Craft::configure($query, $config->criteria[$elementType] ?? []);

        return $query;
    }

    private function _isEligible(ElementInterface $element, ElementLinkConfig $config, EditorConfig $context): bool
    {
        if ($context->requireViewPermission && !Craft::$app->getElements()->canView($element)) {
            return false;
        }

        return !is_callable($config->eligibility) || (bool)($config->eligibility)($element, $context);
    }
}
