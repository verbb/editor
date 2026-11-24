import { element, iconButton } from './dom';
import { icon } from './icons';

export type NoticeKind = 'info' | 'warn' | 'bad';

export interface NoticeAction {
    label: string;
    run: () => void;
}

/**
 * One line under the text for things the author should know now: a refused file, a failed post, a
 * restored draft. It's a live region, so screen readers hear each message once.
 */
export class Notice {
    readonly element = element('div', 'verbb-editor__notice');

    private kind: NoticeKind | null = null;
    private source: string | null = null;

    constructor(private readonly dismissLabel: string) {
        this.element.setAttribute('role', 'status');
    }

    get current(): { kind: NoticeKind | null; source: string | null } {
        return { kind: this.kind, source: this.source };
    }

    /** `source` lets one part of the editor clear only its own message. */
    show(kind: NoticeKind, text: string, actions: NoticeAction[] = [], source: string | null = null): void {
        this.kind = kind;
        this.source = source;
        this.element.className = `verbb-editor__notice is-${kind}`;
        this.element.replaceChildren(icon(kind === 'info' ? 'info' : 'alert'), element('span', 'verbb-editor__notice-text', text));

        for (const action of actions) {
            const button = element('button', 'verbb-editor__link-button', action.label);

            button.type = 'button';
            button.addEventListener('click', action.run);
            this.element.append(button);
        }

        if (kind !== 'info') {
            const dismiss = iconButton('close', this.dismissLabel, 'verbb-editor__notice-close');

            delete dismiss.dataset.tip;
            dismiss.addEventListener('click', () => this.clear());
            this.element.append(dismiss);
        }
    }

    clear(source?: string): void {
        if (source !== undefined && this.source !== source) return;

        this.kind = null;
        this.source = null;
        this.element.className = 'verbb-editor__notice';
        this.element.replaceChildren();
    }
}
