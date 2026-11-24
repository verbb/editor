import { element } from './dom';

interface OpenPopover {
    kind: string;
    element: HTMLElement;
    trigger: HTMLElement | null;
    onClose?: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]';

/**
 * One popover per editor at a time: link, More, help, alt text or a suggestion list. It closes on an
 * outside press, on Escape and when focus leaves it, and returns focus to whatever opened it, or to
 * the text. Escape stops here, so a host dialog around the editor stays open.
 */
export class Popovers {
    private current: OpenPopover | null = null;

    private readonly outside = (event: Event) => {
        const target = event.target as Node;

        if (this.current && !this.current.element.contains(target) && !this.current.trigger?.contains(target)) this.close(false);
    };

    constructor(
        private readonly root: HTMLElement,
        private readonly refocusText: () => void,
    ) {}

    get kind(): string | null {
        return this.current?.kind ?? null;
    }

    get element(): HTMLElement | null {
        return this.current?.element ?? null;
    }

    open(kind: string, className: string, options: { trigger?: HTMLElement | null; onClose?: () => void } = {}): HTMLElement {
        this.close(false);

        const popover = element('div', `verbb-editor__pop ${className}`.trim());

        this.current = { kind, element: popover, trigger: options.trigger ?? null, onClose: options.onClose };
        options.trigger?.setAttribute('aria-expanded', 'true');
        popover.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();

                if (this.current?.element === popover) this.close();
            } else if (event.key === 'Tab') {
                this.tabOut(event, popover);
            }
        });
        popover.addEventListener('focusout', (event) => {
            const to = event.relatedTarget as Node | null;

            if (to && this.current?.element === popover && !popover.contains(to) && !this.current.trigger?.contains(to)) this.close(false);
        });
        this.root.append(popover);
        document.addEventListener('mousedown', this.outside, true);

        return popover;
    }

    /** `refocus` returns focus to the trigger if there was one, otherwise to the text. */
    close(refocus = true): void {
        const current = this.current;

        if (!current) return;

        this.current = null;
        document.removeEventListener('mousedown', this.outside, true);
        current.trigger?.setAttribute('aria-expanded', 'false');
        current.element.remove();
        current.onClose?.();

        if (!refocus) return;

        if (current.trigger?.isConnected) current.trigger.focus();
        else this.refocusText();
    }

    destroy(): void {
        this.close(false);
    }

    /**
     * The popover sits at the end of the editor, so tabbing out of it would skip the controls after
     * its trigger. Leaving forwards continues from the trigger (or the text), and backwards returns to it.
     */
    private tabOut(event: KeyboardEvent, popover: HTMLElement): void {
        const current = this.current;

        if (!current || current.element !== popover) return;

        const focusables = [...popover.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.tabIndex >= 0);
        const edge = event.shiftKey ? focusables[0] : focusables[focusables.length - 1];

        if (focusables.length && document.activeElement !== edge) return;

        if (event.shiftKey) {
            event.preventDefault();
            this.close();

            return;
        }

        // Focus moves synchronously, so the browser's own Tab then carries on from there.
        this.close(false);

        if (current.trigger?.isConnected) current.trigger.focus();
        else this.root.querySelector<HTMLElement>('.ProseMirror')?.focus();
    }
}
