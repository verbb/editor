import type { Schema } from '@tiptap/pm/model';

import type { EditorContent, ResolvedEditorFeatures } from '../types';

const LEGACY_NODE_NAMES: Record<string, string> = {
    bullet_list: 'bulletList',
    code_block: 'codeBlock',
    hard_break: 'hardBreak',
    horizontal_rule: 'horizontalRule',
    list_item: 'listItem',
    ordered_list: 'orderedList',
};

// Nodes that hold other nodes. Anything else without content is an atom, so custom extensions count too.
const STRUCTURAL_NODES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'hardBreak'];
const INLINE_NODES = ['text', 'hardBreak', 'mention'];

/**
 * Attributes that only exist for display while editing. The server fills them in through
 * `Documents::resolve()` and stores references only, so they stay out of submitted JSON and
 * out of dirty checks.
 */
const RESOLVED_NODE_ATTRS: Record<string, string[]> = {
    editorAsset: ['src'],
    attachment: ['filename', 'url', 'mimeType', 'size'],
};
const RESOLVED_MARK_ATTRS: Record<string, string[]> = {
    craftLink: ['href'],
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

// The same characters the server strips. Joiners and other meaningful Unicode are authored text.
export function stripInvisibleChars(value: string): string {
    return value.replace(/[​⁠﻿]/g, '');
}

function createParagraphContent(value: string): EditorContent {
    const text = stripInvisibleChars(value);

    if (text === '') {
        return [];
    }

    const content: EditorContent = [];

    text.split(/\r\n|\r|\n/).forEach((line, index) => {
        if (index > 0) content.push({ type: 'hardBreak' });
        if (line) content.push({ type: 'text', text: line });
    });

    return [{ type: 'paragraph', content }];
}

function normalizeNodeValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizeNodeValue);
    if (!isRecord(value)) return value;

    const record = { ...value };

    // Only structural node/mark identifiers are legacy names; attributes and text are data.
    if (typeof record.type === 'string') record.type = LEGACY_NODE_NAMES[record.type] ?? record.type;
    if (Array.isArray(record.content)) record.content = record.content.map(normalizeNodeValue);
    if (Array.isArray(record.marks)) record.marks = record.marks.map(normalizeNodeValue);

    return record;
}

export function normalizeContentArray(content: unknown): EditorContent {
    if (!Array.isArray(content)) {
        return [];
    }

    const normalized: EditorContent = [];

    for (const node of content) {
        if (!isRecord(node)) {
            continue;
        }

        if (!('type' in node) && Array.isArray(node.content)) {
            normalized.push(...normalizeContentArray(node.content));
            continue;
        }

        if (typeof node.type !== 'string') continue;

        const record = { ...node };

        if (record.type === 'text') {
            const text = typeof record.text === 'string' ? stripInvisibleChars(record.text) : '';

            if (text === '') {
                continue;
            }

            normalized.push({ ...record, text });
            continue;
        }

        if (Array.isArray(record.content)) {
            record.content = normalizeContentArray(record.content);
        }

        normalized.push(record);
    }

    return normalized;
}

/**
 * The decoded document when a string holds a `doc` object or a non-empty array of objects with a
 * string `type`. `null` for everything else, including JSON such as `123`, `[1,2]` and `{"a":1}`.
 * The server applies the same rule.
 */
function decodeDocument(value: string): unknown {
    let decoded: unknown;

    try {
        decoded = JSON.parse(value);
    } catch {
        return null;
    }

    if (isRecord(decoded)) {
        return decoded.type === 'doc' ? decoded : null;
    }

    if (Array.isArray(decoded) && decoded.length && decoded.every((node) => isRecord(node) && typeof node.type === 'string')) {
        return decoded;
    }

    return null;
}

export function normalizeContent(value: unknown): EditorContent {
    if (value == null || value === '') {
        return [];
    }

    if (typeof value === 'string') {
        const document = decodeDocument(value);

        return document === null ? createParagraphContent(value) : normalizeContent(document);
    }

    if (typeof value === 'number') {
        return createParagraphContent(String(value));
    }

    const normalizedValue = normalizeNodeValue(value);

    if (Array.isArray(normalizedValue)) {
        return normalizeContentArray(normalizedValue);
    }

    if (isRecord(normalizedValue)) {
        if (normalizedValue.type === 'doc') {
            return normalizeContent(Array.isArray(normalizedValue.content) ? normalizedValue.content : []);
        }

        if (normalizedValue.type) {
            return normalizeContentArray([normalizedValue]);
        }
    }

    return [];
}

export function toDoc(content: EditorContent): { type: 'doc'; content: EditorContent } {
    return {
        type: 'doc',
        content,
    };
}

function isEmptyContent(nodes: unknown[]): boolean {
    return nodes.every((node) => {
        if (!isRecord(node)) return true;

        if (node.type === 'text') {
            return !/[^\s\p{Z}]/u.test(stripInvisibleChars(String(node.text ?? '')));
        }

        if (Array.isArray(node.content)) {
            return isEmptyContent(node.content);
        }

        return STRUCTURAL_NODES.includes(String(node.type));
    });
}

/**
 * A document is empty when it has no non-whitespace text after stripping invisible characters and
 * no atom. Image-only bodies stay valid. The server applies the same rule.
 */
export function contentIsEmpty(content: EditorContent): boolean {
    return isEmptyContent(content);
}

function nodeToPlainText(node: JsonRecord): string {
    if (node.type === 'attachment') return stripInvisibleChars(String((node.attrs as JsonRecord | undefined)?.filename ?? ''));
    if (node.type === 'editorAsset') return stripInvisibleChars(String((node.attrs as JsonRecord | undefined)?.alt ?? ''));

    return Array.isArray(node.content) ? joinPlainText(node.content, '\n') : '';
}

function inlineToPlainText(node: JsonRecord): string {
    if (node.type === 'text') return stripInvisibleChars(String(node.text ?? ''));
    if (node.type === 'hardBreak') return '\n';

    return `@${stripInvisibleChars(String((node.attrs as JsonRecord | undefined)?.label ?? ''))}`;
}

function joinPlainText(nodes: unknown[], separator: string): string {
    const blocks: string[] = [];
    let run = '';

    for (const node of nodes) {
        if (!isRecord(node)) continue;

        if (INLINE_NODES.includes(String(node.type))) {
            run += inlineToPlainText(node);
            continue;
        }

        if (run) {
            blocks.push(run);
            run = '';
        }

        blocks.push(nodeToPlainText(node));
    }

    if (run) blocks.push(run);

    return blocks.filter(Boolean).join(separator);
}

/**
 * Deterministic plain text, shared with the server's `PlainText` helper: top-level blocks are
 * separated by a blank line, nested blocks and list items by a newline.
 */
export function contentToPlainText(content: EditorContent): string {
    return joinPlainText(normalizeContent(content), '\n\n');
}

/**
 * How many characters of writing a document holds, the count `limit` uses and the server's
 * `RichText::getTextLength()` matches: its plain text without image alt text or attachment
 * filenames, in Unicode characters rather than UTF-16 units, as PHP's `mb_strlen()` counts.
 */
export function contentTextLength(content: EditorContent): number {
    const text = normalizeContent(content).filter((node) => node.type !== 'editorAsset' && node.type !== 'attachment');

    return Array.from(contentToPlainText(text)).length;
}

export function contentEquals(left: EditorContent, right: EditorContent): boolean {
    return JSON.stringify(normalizeContent(left)) === JSON.stringify(normalizeContent(right));
}

function withoutKeys(attrs: unknown, keys: string[] | undefined): unknown {
    if (!keys || !isRecord(attrs)) return attrs;

    return Object.fromEntries(Object.entries(attrs).filter(([key]) => !keys.includes(key)));
}

/** Removes display-only values, so what's submitted matches what the server stores. */
export function withoutResolvedAttrs(content: EditorContent): EditorContent {
    return content.map((node) => {
        const result: JsonRecord = { ...node };

        if (result.attrs !== undefined) result.attrs = withoutKeys(result.attrs, RESOLVED_NODE_ATTRS[String(node.type)]);

        if (Array.isArray(result.marks)) {
            result.marks = result.marks.map((mark) => (isRecord(mark) && mark.attrs !== undefined
                ? { ...mark, attrs: withoutKeys(mark.attrs, RESOLVED_MARK_ATTRS[String(mark.type)]) }
                : mark));
        }

        if (Array.isArray(result.content)) result.content = withoutResolvedAttrs(result.content as EditorContent);

        return result;
    });
}

function nearestHeadingLevel(level: unknown, allowed: number[]): number | null {
    const requested = typeof level === 'string' && level.trim() !== '' ? Number(level) : level;

    if (typeof requested !== 'number' || !Number.isInteger(requested) || !allowed.length) return null;

    // The nearest allowed level, the lower number on a tie. The server applies the same rule.
    return [...allowed].sort((a, b) => a - b).reduce((nearest, candidate) => (
        Math.abs(candidate - requested) < Math.abs(nearest - requested) ? candidate : nearest
    ));
}

/**
 * Fits a document to this editor's schema the way the server's Sanitizer fits it to a context, so
 * one document means the same thing on both sides. Blocks stay separate when their feature is off,
 * a disabled mention becomes its label text, and disabled media is removed. Nothing here is a
 * security boundary: the server re-applies all of it.
 */
export function contentForSchema(content: EditorContent, schema: Schema, features?: Pick<ResolvedEditorFeatures, 'headings'>): EditorContent {
    const levels = features?.headings || [];

    const marksFor = (node: JsonRecord): unknown[] => (Array.isArray(node.marks)
        ? node.marks.filter((mark) => isRecord(mark) && typeof mark.type === 'string' && schema.marks[mark.type])
        : []);

    const withMarks = (result: JsonRecord, node: JsonRecord): JsonRecord => {
        const marks = marksFor(node);

        return marks.length ? { ...result, marks } : result;
    };

    const isInline = (node: JsonRecord): boolean => !!schema.nodes[String(node.type)]?.isInline;

    const blocks = (nodes: unknown[]): EditorContent => {
        const result: EditorContent = [];
        let run: EditorContent = [];

        const flush = () => {
            if (run.length) result.push({ type: 'paragraph', content: run });
            run = [];
        };

        for (const node of nodes) {
            if (!isRecord(node)) continue;

            for (const fitted of visit(node, true)) {
                if (isInline(fitted)) {
                    run.push(fitted);
                } else {
                    flush();
                    result.push(fitted);
                }
            }
        }

        flush();

        return result;
    };

    const inlineChildren = (nodes: unknown[]): EditorContent => nodes.flatMap((node) => (isRecord(node) ? visit(node, false) : []));

    const textBlock = (block: JsonRecord, children: unknown[]): EditorContent => {
        const result: EditorContent = [];
        let run: EditorContent = [];

        for (const child of inlineChildren(children)) {
            if (isInline(child)) {
                run.push(child);
            } else {
                if (run.length) result.push({ ...block, content: run });
                run = [];
                result.push(child);
            }
        }

        if (run.length) result.push({ ...block, content: run });
        else if (!result.length) result.push(block);

        return result;
    };

    const list = (node: JsonRecord, children: unknown[]): EditorContent => {
        const items = children.filter(isRecord).map((child) => {
            const fitted = blocks(child.type === 'listItem' && Array.isArray(child.content) ? child.content : [child]);

            if (fitted[0]?.type !== 'paragraph') fitted.unshift({ type: 'paragraph' });

            return { type: 'listItem', content: fitted };
        });

        if (!items.length) return [];

        const start = isRecord(node.attrs) ? Number(node.attrs.start) : NaN;
        const attrs = node.type === 'orderedList' && Number.isInteger(start) && start >= 1 ? { attrs: { start } } : {};

        return [{ type: node.type, ...attrs, content: items }];
    };

    function visit(node: JsonRecord, blockContext: boolean): EditorContent {
        const type = String(node.type);
        const children = Array.isArray(node.content) ? node.content : [];
        const known = !!schema.nodes[type];

        switch (type) {
            case 'text':
                return [withMarks({ type: 'text', text: node.text }, node)];
            case 'paragraph':
                return textBlock({ type: 'paragraph' }, children);
            case 'heading': {
                const level = schema.nodes.heading ? nearestHeadingLevel(isRecord(node.attrs) ? node.attrs.level : null, levels) : null;

                return textBlock(level === null ? { type: 'paragraph' } : { type: 'heading', attrs: { level } }, children);
            }
            case 'bulletList':
            case 'orderedList':
                return known ? list(node, children) : blocks(children);
            case 'listItem':
                // Reached only when the item has no enabled list around it, so each child stands alone.
                return blocks(children);
            case 'blockquote': {
                const quoted = blocks(children);

                return known && quoted.length ? [{ type: 'blockquote', content: quoted }] : quoted;
            }
            case 'mention':
                if (known) break;

                return isRecord(node.attrs) && node.attrs.label ? [{ type: 'text', text: `@${node.attrs.label}` }] : [];
            case 'editorAsset':
            case 'attachment':
                if (known) break;

                return [];
        }

        if (!known) {
            // Unknown wrappers keep their useful children; block context keeps each wrapper's text separate.
            return blockContext ? blocks(children) : inlineChildren(children);
        }

        const result: JsonRecord = { type };

        if (isRecord(node.attrs)) result.attrs = node.attrs;
        if (children.length) result.content = inlineChildren(children);

        return [withMarks(result, node)];
    }

    const fitted = blocks(content);

    // Custom nodes can have content models this can't know about, so anything still invalid falls
    // back to its text rather than failing to mount with the author's content lost.
    try {
        if (fitted.length) schema.nodeFromJSON(toDoc(fitted)).check();

        return fitted;
    } catch {
        const text = contentToPlainText(fitted);

        return text ? text.split('\n\n').map((block) => ({ type: 'paragraph', content: [{ type: 'text', text: block }] })) : [];
    }
}

const MEDIA_NODES = ['editorAsset', 'attachment'];
const CONTAINERS = ['blockquote', 'bulletList', 'orderedList', 'listItem'];

/**
 * Separates images and attachments from the text, in document order. The editor shows them in its
 * uploads tray and appends them after the text when the document is read. A container left empty
 * by the move goes too, since it would otherwise be an invalid empty block.
 */
export function splitMedia(content: EditorContent): { text: EditorContent; media: EditorContent } {
    const media: EditorContent = [];

    const visit = (nodes: unknown[]): EditorContent => {
        const kept: EditorContent = [];

        for (const node of nodes) {
            if (!isRecord(node)) continue;

            if (MEDIA_NODES.includes(String(node.type))) {
                media.push(node);
                continue;
            }

            if (Array.isArray(node.content) && CONTAINERS.includes(String(node.type))) {
                const children = visit(node.content);

                if (!children.length) continue;

                kept.push({ ...node, content: children });
                continue;
            }

            kept.push(node);
        }

        return kept;
    };

    return { text: visit(content), media };
}
