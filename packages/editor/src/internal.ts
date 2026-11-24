import type { Editor } from './Editor';
import type { Notice } from './ui/Notice';
import type { Popovers } from './ui/Popover';

import type { EditorContent, EditorToolbarPosition } from './types';

/**
 * What `<verbb-editor>` needs from the `Editor` it wraps. Kept out of the public API: hosts use the
 * element's own attributes and methods instead.
 */
export interface EditorChrome {
    root: HTMLElement;
    body: HTMLElement;
    foot: HTMLElement;
    /** The toolbar's own row, used when the toolbar isn't in the footer. */
    tools: HTMLElement;
    toolbar: HTMLElement | null;
    toolbarPosition: EditorToolbarPosition;
    notice: Notice;
    popovers: Popovers;
    textLength: () => number;
    hasFailedUploads: () => boolean;
    pendingUploads: () => number;
    uploadTimes: () => Record<number, number>;
    loadWithUploadTimes: (content: EditorContent, uploadTimes: Record<number, number>) => void;
    resolved: () => EditorContent;
    hideFloating: () => void;
    /** Says something to screen readers through the editor's own live region. */
    announce: (message: string) => void;
}

const chromes = new WeakMap<Editor, EditorChrome>();

export function setChrome(editor: Editor, chrome: EditorChrome): void {
    chromes.set(editor, chrome);
}

export function chromeOf(editor: Editor): EditorChrome | undefined {
    return chromes.get(editor);
}
