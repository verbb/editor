import { Editor as TiptapEditor, type Extensions } from '@tiptap/core';

import { createExtensions } from './createExtensions';
import { normalizeContent } from './document';

import type { EditorContent, ResolvedEditorOptions } from '../types';

export function createTiptapEditor(
    element: HTMLElement,
    options: ResolvedEditorOptions,
    listeners: {
        onUpdate?: () => void;
    } = {},
    internal: Extensions = [],
): TiptapEditor {
    const editor = new TiptapEditor({
        element,
        editable: options.editable,
        extensions: [...createExtensions(options), ...internal],
        // Tiptap's injected stylesheet fails under a strict `style-src`, so base.css carries its rules.
        injectCSS: false,
        onUpdate: listeners.onUpdate,
        editorProps: {
            // A function, so changes to these options take effect on the next view update. Tiptap
            // reapplies `editorProps` whenever its options change, such as on `setEditable()`, so
            // attributes set on the view any other way would be lost.
            attributes: () => ({
                role: 'textbox',
                'aria-multiline': 'true',
                'aria-readonly': String(!options.editable),
                // The placeholder is drawn by CSS, which screen readers would otherwise read as text.
                ...(options.placeholder ? { 'aria-placeholder': options.placeholder } : {}),
                ...(options.ariaLabelledBy
                    ? { 'aria-labelledby': options.ariaLabelledBy }
                    : { 'aria-label': options.ariaLabel ?? options.labels.editor }),
            }),
        },
    });

    return editor;
}

/** The document with display-only values included, as the editor holds it. */
export function getResolvedContent(editor: TiptapEditor): EditorContent {
    return editor.isEmpty ? [] : normalizeContent(editor.getJSON());
}
