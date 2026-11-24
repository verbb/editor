import { element } from './dom';
import { icon } from './icons';

import type { EditorTheme, ResolvedEditorOptions } from '../types';

/**
 * The editor's regions: the text, the uploads tray, a notice line and the footer with the toolbar, or
 * the toolbar's own row above the text when it's at the top. `<verbb-editor>` adds a header above the
 * text and its status and actions to the footer.
 */
export class EditorView {
    readonly root = element('div', 'verbb-editor');
    readonly body = element('div', 'verbb-editor__body');
    readonly contentElement = element('div', 'verbb-editor__content');
    readonly foot = element('div', 'verbb-editor__foot');
    /** The toolbar's own row, when it isn't in the footer: above the text, or below it in a frame with fields. */
    readonly tools = element('div', 'verbb-editor__tools');
    readonly drop = element('div', 'verbb-editor__drop');
    /** Visually hidden, for what a screen reader should hear that the page doesn't otherwise say. */
    readonly live = element('span', 'verbb-editor__sr');

    private pending: string[] = [];
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(host: HTMLElement, options: ResolvedEditorOptions) {
        const label = element('span', undefined, options.labels.dropToAttach);

        this.root.dataset.theme = options.theme;
        this.body.append(this.contentElement);
        this.drop.setAttribute('aria-hidden', 'true');
        label.prepend(icon('attach'));
        this.drop.append(label);
        this.live.setAttribute('role', 'status');
        this.root.append(this.body, this.foot, this.drop, this.live);

        // A press on the padding around the text still puts the caret in it.
        this.body.addEventListener('mousedown', (event) => {
            if (event.target === this.body) {
                event.preventDefault();
                this.contentElement.querySelector<HTMLElement>('.ProseMirror')?.focus();
            }
        });

        host.replaceChildren(this.root);
    }

    /**
     * Says something once. The region is emptied first so a repeated message is heard again, and
     * messages arriving together, such as several uploads finishing, are read as one.
     */
    announce(message: string): void {
        this.pending.push(message);
        this.live.textContent = '';
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.live.textContent = this.pending.join(' ');
            this.pending = [];
        }, 30);
    }

    destroy(): void {
        clearTimeout(this.timer);
    }

    setTheme(theme: EditorTheme): void {
        this.root.dataset.theme = theme;
    }
}
