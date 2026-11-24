import Blockquote from '@tiptap/extension-blockquote';
import Bold from '@tiptap/extension-bold';
import Code from '@tiptap/extension-code';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import Italic from '@tiptap/extension-italic';
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import { Dropcursor, Gapcursor, Placeholder, UndoRedo } from '@tiptap/extensions';
import { Mark, Node } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';

import { CraftClient } from '../craft/Client';
import { feature } from '../features/registry';
import { safeUrl } from './urls';

import type { EditorLabels } from '../config/labels';
import type { ResolvedEditorOptions } from '../types';

/**
 * The StarterKit pieces Editor uses, in StarterKit's order so the schema matches. They're imported
 * one by one because StarterKit always bundles its code block and horizontal rule, which Editor
 * never enables.
 */
function baseExtensions(features: ResolvedEditorOptions['features']): Extensions {
    return [
        features.bold && Bold,
        features.blockquote && Blockquote,
        features.lists && BulletList,
        features.code && Code,
        Document,
        Dropcursor,
        Gapcursor,
        HardBreak,
        features.headings && Heading.configure({ levels: features.headings as (1 | 2 | 3 | 4 | 5 | 6)[] }),
        UndoRedo,
        features.italic && Italic,
        features.lists && ListItem,
        features.lists && OrderedList,
        Paragraph,
        features.strike && Strike,
        Text,
    ].filter((extension) => !!extension) as Extensions;
}

const Underline = Mark.create({
    name: 'underline',
    parseHTML: () => [
        { tag: 'u' },
        { style: 'text-decoration', consuming: false, getAttrs: (value) => (String(value).includes('underline') ? {} : false) },
    ],
    renderHTML: () => ['u', 0],
    addKeyboardShortcuts() {
        return { 'Mod-u': () => this.editor.commands.toggleMark('underline') };
    },
});

const CraftLink = Mark.create({
    name: 'craftLink',
    priority: 1100,
    inclusive: false,
    excludes: 'link',
    addAttributes() {
        return {
            id: { default: null, parseHTML: (element) => Number(element.getAttribute('data-craft-link-id')) || null },
            type: { default: null, parseHTML: (element) => element.getAttribute('data-craft-link-type') },
            label: { default: null, parseHTML: (element) => element.getAttribute('data-craft-link-label') },
            href: { default: null, parseHTML: (element) => safeUrl(element.getAttribute('href')) || null },
        };
    },
    parseHTML: () => [{ tag: 'a[data-craft-link-id]', priority: 1100 }],
    renderHTML({ mark }) {
        return ['a', {
            href: safeUrl(mark.attrs.href) || null,
            'data-craft-link-id': mark.attrs.id,
            'data-craft-link-type': mark.attrs.type,
            'data-craft-link-label': mark.attrs.label,
        }, 0];
    },
});

function createEditorAsset(labels: EditorLabels) {
    return Node.create<Record<string, never>, { previews: Map<number, string> }>({
        name: 'editorAsset',
        group: 'block',
        atom: true,
        draggable: true,
        addStorage() {
            return { previews: new Map<number, string>() };
        },
        addAttributes() {
            return {
                id: { default: null, parseHTML: (element) => Number(element.getAttribute('data-editor-asset-id')) || null },
                src: { default: null, parseHTML: (element) => safeUrl(element.getAttribute('src'), true) || null },
                alt: { default: null },
                title: { default: null },
            };
        },
        parseHTML: () => [{ tag: 'img[data-editor-asset-id]' }],
        renderHTML({ node }) {
            return ['img', {
                'data-editor-asset-id': node.attrs.id,
                src: safeUrl(node.attrs.src, true) || null,
                alt: node.attrs.alt ?? '',
                title: node.attrs.title,
            }];
        },
        addNodeView() {
            return ({ node }) => {
                const dom = document.createElement('span');
                dom.className = 'verbb-editor__image';

                const render = (current: typeof node) => {
                    const src = safeUrl(current.attrs.src, true) || this.storage.previews.get(current.attrs.id);

                    if (src) {
                        const image = document.createElement('img');
                        image.src = src;
                        image.dataset.editorAssetId = String(current.attrs.id);
                        image.alt = current.attrs.alt ?? '';

                        if (current.attrs.title) image.title = current.attrs.title;

                        dom.replaceChildren(image);
                    } else {
                        dom.textContent = current.attrs.alt || current.attrs.title || labels.uploadedImage;
                        dom.setAttribute('aria-label', dom.textContent);
                    }
                };

                render(node);

                return {
                    dom,
                    update: (current) => {
                        if (current.type !== node.type) return false;

                        render(current);

                        return true;
                    },
                };
            };
        },
        renderText: ({ node }) => node.attrs.alt ?? '',
    });
}

function createAttachment(labels: EditorLabels) {
    return Node.create({
        name: 'attachment',
        group: 'block',
        atom: true,
        draggable: true,
        addAttributes() {
            return {
                id: { default: null, parseHTML: (element) => Number(element.getAttribute('data-editor-attachment-id')) || null },
                filename: { default: null, parseHTML: (element) => element.getAttribute('data-filename') ?? element.textContent },
                url: { default: null, parseHTML: (element) => safeUrl(element.getAttribute('href')) || null },
                mimeType: { default: null, parseHTML: (element) => element.getAttribute('data-mime-type') },
                size: { default: null, parseHTML: (element) => (element.hasAttribute('data-size') ? Number(element.getAttribute('data-size')) : null) },
            };
        },
        parseHTML: () => [{ tag: 'a[data-editor-attachment-id]', priority: 1100 }],
        renderHTML({ node }) {
            return ['a', {
                href: safeUrl(node.attrs.url) || null,
                'data-editor-attachment-id': node.attrs.id,
                'data-filename': node.attrs.filename,
                'data-mime-type': node.attrs.mimeType,
                'data-size': node.attrs.size,
                class: 'verbb-editor-attachment',
            }, node.attrs.filename ?? labels.attachment];
        },
        addNodeView() {
            // Not a link while editing: clicking one would navigate away and lose the draft, and a
            // click is how an author selects the attachment to edit it.
            return ({ node, editor, getPos }) => {
                const dom = document.createElement('span');
                dom.className = 'verbb-editor-attachment';
                dom.dataset.editorAttachmentId = String(node.attrs.id);

                dom.addEventListener('click', () => {
                    const position = typeof getPos === 'function' ? getPos() : undefined;

                    if (editor.isEditable && typeof position === 'number') editor.commands.setNodeSelection(position);
                });

                const render = (current: typeof node) => {
                    dom.textContent = current.attrs.filename || labels.attachment;
                };

                render(node);

                return {
                    dom,
                    update: (current) => {
                        if (current.type !== node.type) return false;

                        render(current);

                        return true;
                    },
                };
            };
        },
        renderText: ({ node }) => node.attrs.filename ?? labels.attachment,
    });
}

export function createExtensions(options: ResolvedEditorOptions): Extensions {
    const { features, labels } = options;
    const extensions = baseExtensions(features);

    if (features.underline) extensions.push(Underline);

    if (features.link) extensions.push(feature('link').createLinkExtension(features.craftLink));
    if (features.craftLink) extensions.push(CraftLink.extend({ excludes: features.link ? 'craftLink link' : 'craftLink' }));
    if (features.image) extensions.push(createEditorAsset(labels));
    if (features.attachment) extensions.push(createAttachment(labels));
    // The client stays in the core chunk, which every feature chunk shares.
    if (features.mention) extensions.push(feature('mention').createMentionExtension(options.craft ? new CraftClient(options.craft, labels, options.request) : null, options));

    // Always added so the placeholder can change in place, even when it starts empty.
    extensions.push(Placeholder.configure({ placeholder: options.placeholder }));
    extensions.push(...options.extensions);

    return extensions;
}
