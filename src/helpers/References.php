<?php
namespace verbb\editor\helpers;

use verbb\editor\models\DocumentReference;

/**
 * Walks canonical Editor content arrays and extracts structured semantic references.
 */
class References
{
    // Constants
    // =========================================================================

    private const NODE_TYPES = [
        'mention',
        'editorAsset',
        'attachment',
    ];

    private const MARK_TYPES = [
        'craftLink',
    ];


    // Static Methods
    // =========================================================================

    public static function from(mixed $content): self
    {
        $extractor = new self();
        $extractor->_walk(Normalizer::normalize($content));

        return $extractor;
    }


    // Properties
    // =========================================================================

    private array $_references = [];
    private array $_seen = [];


    // Public Methods
    // =========================================================================

    public function all(): array
    {
        return $this->_references;
    }

    public function ofType(string $nodeType): array
    {
        return array_values(array_filter(
            $this->_references,
            static fn(DocumentReference $reference): bool => $reference->nodeType === $nodeType,
        ));
    }

    public function mentions(): array
    {
        return $this->ofType('mention');
    }


    // Private Methods
    // =========================================================================

    private function _walk(array $nodes): void
    {
        foreach ($nodes as $node) {
            if (!is_array($node)) {
                continue;
            }

            $type = (string)($node['type'] ?? '');

            if (in_array($type, self::NODE_TYPES, true)) {
                $this->_add($type, is_array($node['attrs'] ?? null) ? $node['attrs'] : []);
            }

            // Craft links are marks, so they sit on text nodes rather than in the node tree.
            foreach (is_array($node['marks'] ?? null) ? $node['marks'] : [] as $mark) {
                if (is_array($mark) && in_array($mark['type'] ?? null, self::MARK_TYPES, true)) {
                    $this->_add($mark['type'], is_array($mark['attrs'] ?? null) ? $mark['attrs'] : []);
                }
            }

            if (isset($node['content']) && is_array($node['content'])) {
                $this->_walk($node['content']);
            }
        }
    }

    private function _add(string $type, array $attrs): void
    {
        $occurrenceKey = sha1($type . '|' . ($attrs['type'] ?? '') . '|' . ($attrs['id'] ?? ''));

        if (isset($this->_seen[$occurrenceKey])) {
            return;
        }

        $this->_seen[$occurrenceKey] = true;
        $this->_references[] = new DocumentReference([
            'nodeType' => $type,
            'attrs' => $attrs,
            'occurrenceKey' => $occurrenceKey,
        ]);
    }
}
