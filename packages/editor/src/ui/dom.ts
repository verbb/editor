import { icon, type IconName } from './icons';

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);

    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;

    return node;
}

/** An icon button named by `aria-label`, so the tooltip shows the same words. */
export function iconButton(name: IconName, label: string, className = 'verbb-editor__tool'): HTMLButtonElement {
    const button = element('button', className);

    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.dataset.tip = label;
    button.append(icon(name));

    return button;
}

export function textButton(label: string, className = 'verbb-editor__button', name?: IconName): HTMLButtonElement {
    const button = element('button', className);

    button.type = 'button';

    if (name) button.append(icon(name));

    button.append(document.createTextNode(label));

    return button;
}

const isMac = (): boolean => /mac|iphone|ipad|ipod/i.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '',
);

const MAC_KEYS: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Enter: '↵' };
const OTHER_KEYS: Record<string, string> = { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Enter: 'Enter' };

/** Turns a Tiptap-style key such as `Mod-Shift-8` into what this platform's keyboard says. */
export function displayShortcut(keys: string): string {
    if (!keys) return '';

    const map = isMac() ? MAC_KEYS : OTHER_KEYS;
    const parts = keys.split('-').map((part) => map[part] ?? part.toUpperCase());

    return isMac() ? parts.join('') : parts.join('+');
}

export function ariaShortcut(keys: string): string {
    return keys.split('-').map((part) => ({ Mod: isMac() ? 'Meta' : 'Control', Alt: 'Alt', Shift: 'Shift' }[part] ?? part.toUpperCase())).join('+');
}

/** Phones and tablets show their own selection menus, so floating formatting stays off there. */
export function isTouch(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export interface Anchor {
    left: number;
    /** Where the anchor starts in a right-to-left layout. Defaults to `left`, as for a caret. */
    right?: number;
    top: number;
    bottom: number;
}

export function isRtl(node: Element): boolean {
    return getComputedStyle(node).direction === 'rtl';
}

/**
 * Positions a floating element inside its editor root, below the anchor unless there's more room
 * above it, and kept within the root's width. It lines up with the anchor's start edge, which is
 * its right edge in a right-to-left layout.
 */
export function place(floating: HTMLElement, root: HTMLElement, anchor: Anchor, prefer: 'below' | 'above' = 'below'): void {
    const bounds = root.getBoundingClientRect();
    const width = floating.offsetWidth;
    const height = floating.offsetHeight;
    const below = window.innerHeight - anchor.bottom;
    const above = anchor.top;
    const up = prefer === 'above' ? above > height + 8 || above > below : below < height + 8 && above > below;
    const start = isRtl(root) ? (anchor.right ?? anchor.left) - width : anchor.left;
    const left = Math.max(4, Math.min(bounds.width - width - 4, start - bounds.left));

    floating.style.left = `${bounds.width < width + 8 ? 0 : left}px`;
    floating.style.top = `${(up ? anchor.top - height - 6 : anchor.bottom + 6) - bounds.top}px`;
    floating.classList.toggle('is-above', up);
}

/**
 * One tooltip per editor, showing a control's name and shortcut on hover and on keyboard focus.
 * Controls opt in with `data-tip`, plus `data-keys` for a shortcut. Escape dismisses it, and the
 * pointer can move onto it without it disappearing (WCAG 1.4.13).
 */
export class Tooltip {
    readonly element = element('div', 'verbb-editor__tip');

    private timer: ReturnType<typeof setTimeout> | undefined;
    private leaveTimer: ReturnType<typeof setTimeout> | undefined;
    private owner: HTMLElement | null = null;

    private readonly over = (event: Event) => {
        if (this.element.contains(event.target as Node)) return;

        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tip]');

        if (target === this.owner) clearTimeout(this.leaveTimer);
        if (!target || target === this.owner || !this.root.contains(target)) return;

        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.show(target), this.owner ? 0 : 400);
    };

    private readonly out = (event: MouseEvent) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tip]');
        const to = event.relatedTarget as Node | null;

        if (!target || target.contains(to) || this.element.contains(to)) return;

        clearTimeout(this.timer);
        // A moment's grace, so the pointer can cross the gap onto the tooltip.
        clearTimeout(this.leaveTimer);
        this.leaveTimer = setTimeout(() => this.hide(), 150);
    };

    private readonly enterTip = () => clearTimeout(this.leaveTimer);

    private readonly leaveTip = (event: MouseEvent) => {
        if (!this.owner?.contains(event.relatedTarget as Node | null)) this.hide();
    };

    private readonly escape = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && !this.element.hidden) this.hide();
    };

    private readonly focus = (event: Event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tip]');

        if (target && target.matches(':focus-visible')) this.show(target);
        else this.hide();
    };

    private readonly hideNow = () => this.hide();

    constructor(private readonly root: HTMLElement) {
        this.element.setAttribute('role', 'tooltip');
        this.element.hidden = true;
        root.append(this.element);
        root.addEventListener('mouseover', this.over);
        root.addEventListener('mouseout', this.out);
        root.addEventListener('focusin', this.focus);
        root.addEventListener('focusout', this.hideNow);
        root.addEventListener('mousedown', this.hideNow);
        root.addEventListener('keydown', this.escape);
        this.element.addEventListener('mouseenter', this.enterTip);
        this.element.addEventListener('mouseleave', this.leaveTip);
    }

    hide(): void {
        clearTimeout(this.timer);
        clearTimeout(this.leaveTimer);
        this.owner = null;
        this.element.hidden = true;
    }

    destroy(): void {
        this.hide();
        this.root.removeEventListener('mouseover', this.over);
        this.root.removeEventListener('mouseout', this.out);
        this.root.removeEventListener('focusin', this.focus);
        this.root.removeEventListener('focusout', this.hideNow);
        this.root.removeEventListener('mousedown', this.hideNow);
        this.root.removeEventListener('keydown', this.escape);
        this.element.remove();
    }

    private show(target: HTMLElement): void {
        const text = target.dataset.tip;

        if (!text || !target.isConnected) return;

        this.owner = target;
        this.element.replaceChildren(document.createTextNode(text));

        if (target.dataset.keys) this.element.append(element('kbd', undefined, target.dataset.keys));

        this.element.hidden = false;

        const rect = target.getBoundingClientRect();
        const bounds = this.root.getBoundingClientRect();
        const width = this.element.offsetWidth;
        const height = this.element.offsetHeight;
        const top = rect.top - height - 8 < 0 ? rect.bottom + 8 : rect.top - height - 8;

        this.element.style.left = `${Math.max(0, Math.min(bounds.width - width, rect.left + rect.width / 2 - width / 2 - bounds.left))}px`;
        this.element.style.top = `${top - bounds.top}px`;
    }
}
