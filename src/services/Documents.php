<?php
namespace verbb\editor\services;

use verbb\editor\Editor;
use verbb\editor\enums\AssetKind;
use verbb\editor\enums\Feature;
use verbb\editor\errors\DocumentLimitException;
use verbb\editor\helpers\Normalizer;
use verbb\editor\helpers\PlainText;
use verbb\editor\helpers\References;
use verbb\editor\helpers\Sanitizer;
use verbb\editor\helpers\Tiptap;
use verbb\editor\models\EditorConfig;
use verbb\editor\RichText;

use Craft;
use craft\base\Component;
use craft\helpers\Json;

use Throwable;

class Documents extends Component
{
    // Public Methods
    // =========================================================================

    /**
     * The save boundary: normalises and sanitises submitted content, and enforces the context's
     * limits. Rendering stored content never throws, so limits are not checked there.
     */
    public function normalize(mixed $value, ?EditorConfig $config = null): RichText
    {
        $maxBytes = $config->maxBytes ?? EditorConfig::DEFAULT_MAX_BYTES;

        if (is_string($value) && strlen($value) > $maxBytes) {
            throw new DocumentLimitException(Craft::t('editor', 'This content is too long.'));
        }

        $richText = RichText::from($value);
        $this->_assertWithinLimits($richText->getValue(), $config);
        $sanitized = $this->sanitize($richText, $config);
        $this->_assertAssetCounts($sanitized->getValue(), $config);

        return $sanitized;
    }

    public function sanitize(RichText $richText, ?EditorConfig $config = null): RichText
    {
        return new RichText(Sanitizer::sanitize($richText->getValue(), $config));
    }

    public function toHtml(RichText $richText, ?EditorConfig $config = null, bool $nl2br = false, array $associatedAssetIds = []): string
    {
        return $this->renderAll([$richText], $config, $nl2br, [$associatedAssetIds])[0];
    }

    public function toPlainText(RichText $richText, ?EditorConfig $config = null, array $associatedAssetIds = []): string
    {
        $content = $this->_prepare([$richText], $config, [$associatedAssetIds])[0];

        return Normalizer::stripInvisibleChars(PlainText::render($content));
    }

    /**
     * Renders many documents with one resolver call per kind of reference, keeping list pages free
     * of per-document queries. `$associatedAssetIds` is keyed like `$documents`, and holds the Asset
     * IDs the consumer has recorded against each one. Returns HTML under the same keys.
     */
    public function renderAll(array $documents, ?EditorConfig $config = null, bool $nl2br = false, array $associatedAssetIds = []): array
    {
        $extensions = $config?->extensions ?? [];
        $rendered = [];

        foreach ($this->_prepare($documents, $config, $associatedAssetIds) as $key => $content) {
            $rendered[$key] = Tiptap::contentToHtml($content, $extensions, $nl2br);
        }

        return $rendered;
    }

    /**
     * Fills references in with their resolved values, for handing to the browser when editing. The
     * browser keeps those values for display and leaves them out of the JSON it submits.
     */
    public function resolve(RichText $richText, ?EditorConfig $config = null, array $associatedAssetIds = []): RichText
    {
        return new RichText($this->_prepare([$richText], $config, [$associatedAssetIds])[0]);
    }

    public function extractReferences(RichText $richText): array
    {
        return References::from($richText->getValue())->all();
    }

    public function extractMentions(RichText $richText): array
    {
        return References::from($richText->getValue())->mentions();
    }


    // Private Methods
    // =========================================================================

    private function _prepare(array $documents, ?EditorConfig $config, array $associatedAssetIds): array
    {
        $prepared = [];

        foreach ($documents as $key => $document) {
            $prepared[$key] = Sanitizer::sanitize(RichText::from($document)->getValue(), $config);
        }

        if ($config === null) {
            return array_map(Sanitizer::degradeStructuredNodes(...), $prepared);
        }

        $associated = [];

        foreach ($prepared as $key => $content) {
            $associated[$key] = array_map('intval', $associatedAssetIds[$key] ?? []);
        }

        $resolved = $this->_resolveReferences($prepared, $associated, $config);

        foreach ($prepared as $key => $content) {
            $prepared[$key] = $this->_applyResolved($content, $resolved, $associated[$key]);
        }

        return $prepared;
    }

    /**
     * Collects each kind of reference across all documents, then asks its provider once. A provider
     * failure must not break the page, so it degrades to the unresolved fallback and is logged.
     */
    private function _resolveReferences(array $documents, array $associated, EditorConfig $config): array
    {
        $references = ['mention' => [], 'craftLink' => [], 'asset' => []];

        foreach ($documents as $key => $content) {
            $this->_collectReferences($content, $associated[$key], $references);
        }

        $resolved = ['mention' => [], 'craftLink' => [], 'asset' => []];

        try {
            if ($references['mention'] !== [] && $config->isEnabled(Feature::Mention)) {
                $resolved['mention'] = $config->getMentionProvider()->resolveAll($references['mention'], $config->mentions, $config);
            }
        } catch (Throwable $e) {
            Editor::error('Unable to resolve mentions: ' . $e->getMessage());
        }

        try {
            if ($references['craftLink'] !== [] && $config->isEnabled(Feature::CraftLink)) {
                $resolved['craftLink'] = $config->getElementProvider()->resolveAll($references['craftLink'], $config->elementLinks, $config);
            }
        } catch (Throwable $e) {
            Editor::error('Unable to resolve Craft links: ' . $e->getMessage());
        }

        try {
            if ($references['asset'] !== [] && $config->assets !== null) {
                $resolved['asset'] = $config->getAssetResolver()->resolveAll($references['asset'], $config->assets, $config);
            }
        } catch (Throwable $e) {
            Editor::error('Unable to resolve assets: ' . $e->getMessage());
        }

        return $resolved;
    }

    private function _collectReferences(array $nodes, array $associated, array &$references): void
    {
        foreach ($nodes as $node) {
            $type = $node['type'] ?? null;
            $attrs = $node['attrs'] ?? [];

            if ($type === 'mention') {
                $references['mention'][$this->_referenceKey($attrs)] = $attrs;
            } elseif ($type === 'editorAsset' || $type === 'attachment') {
                // Only IDs the consumer associated with this document can reach a provider.
                if (in_array($attrs['id'], $associated, true)) {
                    $kind = $this->_assetKind($type);
                    $references['asset'][$kind->value . ':' . $attrs['id']] = $attrs + ['kind' => $kind->value];
                }
            }

            foreach ($node['marks'] ?? [] as $mark) {
                if ($mark['type'] === 'craftLink') {
                    $references['craftLink'][$this->_referenceKey($mark['attrs'])] = $mark['attrs'];
                }
            }

            if (isset($node['content'])) {
                $this->_collectReferences($node['content'], $associated, $references);
            }
        }
    }

    private function _applyResolved(array $content, array $resolved, array $associated): array
    {
        return Sanitizer::mapStructuredNodes($content, function(array $node) use ($resolved, $associated): ?array {
            if ($node['type'] === 'mention') {
                $mention = $resolved['mention'][$this->_referenceKey($node['attrs'])] ?? null;

                // A mention nobody can vouch for keeps its stored label, as plain unlinked text.
                if (!is_array($mention) || !is_string($mention['label'] ?? null) || $mention['label'] === '') {
                    return Sanitizer::mentionText($node);
                }

                $node['attrs']['label'] = $mention['label'];

                return $node;
            }

            $kind = $this->_assetKind($node['type']);
            $id = $node['attrs']['id'];
            $asset = in_array($id, $associated, true) ? ($resolved['asset'][$kind->value . ':' . $id] ?? null) : null;
            $url = is_array($asset) ? ($asset['url'] ?? null) : null;

            // Providers are trusted for policy, but their URLs still reach an attribute, so check them too.
            if (!is_string($url) || !Sanitizer::isSafeResourceUrl($url)) {
                return null;
            }

            if ($kind === AssetKind::InlineImage) {
                $node['attrs']['src'] = Sanitizer::trimUrl($url);

                return $node;
            }

            $node['attrs'] = [
                'id' => $id,
                'filename' => $asset['filename'] ?? null,
                'url' => Sanitizer::trimUrl($url),
                'mimeType' => $asset['mimeType'] ?? null,
                'size' => $asset['size'] ?? null,
            ];

            return $node;
        }, function(array $mark) use ($resolved): ?array {
            $element = $resolved['craftLink'][$this->_referenceKey($mark['attrs'])] ?? null;
            $url = is_array($element) ? ($element['url'] ?? null) : null;

            if (!is_string($url) || !Sanitizer::isSafeLink($url)) {
                return null;
            }

            $mark['attrs']['label'] = $element['label'] ?? ($mark['attrs']['label'] ?? null);
            $mark['attrs']['href'] = Sanitizer::trimUrl($url);

            return $mark;
        });
    }

    private function _referenceKey(array $attrs): string
    {
        return $attrs['type'] . ':' . $attrs['id'];
    }

    private function _assetKind(string $nodeType): AssetKind
    {
        return $nodeType === 'editorAsset' ? AssetKind::InlineImage : AssetKind::Attachment;
    }

    private function _assertWithinLimits(array $content, ?EditorConfig $config): void
    {
        $maxNodes = $config->maxNodes ?? EditorConfig::DEFAULT_MAX_NODES;
        $maxDepth = $config->maxDepth ?? EditorConfig::DEFAULT_MAX_DEPTH;
        $maxBytes = $config->maxBytes ?? EditorConfig::DEFAULT_MAX_BYTES;

        if (strlen(Json::encode($content)) > $maxBytes) {
            throw new DocumentLimitException(Craft::t('editor', 'This content is too long.'));
        }

        $count = 0;
        // Walk with an explicit stack, so a hostile depth is refused rather than recursed into.
        $stack = [[$content, 1]];

        while ($stack !== []) {
            [$nodes, $depth] = array_pop($stack);

            if ($depth > $maxDepth) {
                throw new DocumentLimitException(Craft::t('editor', 'This content is nested too deeply.'));
            }

            foreach ($nodes as $node) {
                $count++;

                if ($count > $maxNodes) {
                    throw new DocumentLimitException(Craft::t('editor', 'This content is too long.'));
                }

                if (is_array($node) && is_array($node['content'] ?? null)) {
                    $stack[] = [$node['content'], $depth + 1];
                }
            }
        }
    }

    private function _assertAssetCounts(array $content, ?EditorConfig $config): void
    {
        $assets = $config?->assets;

        if ($assets === null) {
            return;
        }

        $references = References::from($content);

        if ($assets->maxImages !== null && count($references->ofType('editorAsset')) > $assets->maxImages) {
            throw new DocumentLimitException(Craft::t('editor', 'This content has too many images.'));
        }

        if ($assets->maxAttachments !== null && count($references->ofType('attachment')) > $assets->maxAttachments) {
            throw new DocumentLimitException(Craft::t('editor', 'This content has too many attachments.'));
        }
    }
}
