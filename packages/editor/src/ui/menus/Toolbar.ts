import type { Editor as TiptapEditor } from '@tiptap/core';

import { formatLabel } from '../../config/labels';
import { ariaShortcut, displayShortcut, element, iconButton, isRtl, place } from '../dom';
import { icon, type IconName } from '../icons';
import type { Popovers } from '../Popover';

import type { EditorTool, ResolvedEditorOptions } from '../../types';

export interface ToolDefinition {
    id: string;
    tool: EditorTool | 'undo' | 'redo' | 'help';
    icon: IconName;
    label: string;
    keys?: string;
    /** Shown instead of `keys` when the shortcut is a character rather than a chord. */
    hint?: string;
    run: (trigger: HTMLElement) => void;
    /** For a control that opens a popover of its own, such as GIF search. */
    popup?: 'dialog';
    isActive?: () => boolean;
    isDisabled?: () => boolean;
}

export interface ToolbarActions {
    openLink: () => void;
    canLink: () => boolean;
    pickFiles: () => void;
    canAttach: () => boolean;
    photosOnly: () => boolean;
    canMention: () => boolean;
    openGifs: (trigger: HTMLElement) => void;
    canGif: () => boolean;
    /** Extra shortcut rows for formatting help, such as how to post. */
    helpRows: () => [string, string][];
}

// What sits on the bar when a host doesn't choose: the common marks, then what to insert.
const DEFAULT_BAR: EditorTool[] = ['bold', 'italic', 'link', 'bulletList', 'blockquote', 'mention', 'attach', 'gif'];
const INSERT_TOOLS: EditorTool[] = ['mention', 'attach', 'gif'];

/**
 * The footer toolbar: icon controls with tooltips and shortcuts, one tab stop with arrow keys inside
 * it, and a More menu for the controls a host enabled but didn't put on the bar.
 */
export class Toolbar {
    readonly element = element('div', 'verbb-editor__toolbar');

    private readonly buttons = new Map<HTMLButtonElement, ToolDefinition>();
    private readonly tools: ToolDefinition[];
    private readonly moreTools: (ToolDefinition | null)[];
    private moreButton: HTMLButtonElement | null = null;
    private readonly resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.updateClip()) : null;

    constructor(
        private readonly editor: TiptapEditor,
        private readonly options: ResolvedEditorOptions,
        private readonly root: HTMLElement,
        private readonly popovers: Popovers,
        private readonly actions: ToolbarActions,
    ) {
        this.element.setAttribute('role', 'toolbar');
        this.element.setAttribute('aria-label', options.labels.toolbar);
        this.tools = this.definitions();

        // Without a toolbar nothing is on the bar, but the controls still serve the selection bubble.
        const chosen = options.toolbar === false ? [] : options.toolbar ?? DEFAULT_BAR;
        const onBar = this.tools.filter((tool) => chosen.includes(tool.tool as EditorTool));

        onBar.sort((a, b) => chosen.indexOf(a.tool as EditorTool) - chosen.indexOf(b.tool as EditorTool));

        let previousInsert: boolean | null = null;

        for (const tool of onBar) {
            const insert = INSERT_TOOLS.includes(tool.tool as EditorTool);

            if (previousInsert === false && insert) this.element.append(this.separator());

            previousInsert = insert;
            this.element.append(this.button(tool));
        }

        const rest = this.tools.filter((tool) => !onBar.includes(tool));
        const history = this.historyTools();

        this.moreTools = [...rest, ...(rest.length ? [null] : []), ...history, null, this.helpTool()];

        if (onBar.length) this.element.append(this.separator());

        this.moreButton = iconButton('more', options.labels.more);
        this.moreButton.dataset.command = 'more';
        this.moreButton.setAttribute('aria-haspopup', 'menu');
        this.moreButton.setAttribute('aria-expanded', 'false');
        this.moreButton.tabIndex = -1;
        this.moreButton.addEventListener('mousedown', (event) => event.preventDefault());
        this.moreButton.addEventListener('click', () => {
            if (this.popovers.kind === 'more') this.popovers.close(false);
            else this.openMore();
        });
        this.moreButton.addEventListener('focus', () => this.setTabStop(this.moreButton!));
        this.element.append(this.moreButton);
        this.element.addEventListener('keydown', (event) => this.handleArrowKeys(event));
        this.element.addEventListener('scroll', () => this.updateClip(), { passive: true });
        this.resize?.observe(this.element);
    }

    /** Every enabled formatting control, for the selection bubble and keyboard help. */
    get definitionsById(): Map<string, ToolDefinition> {
        return new Map(this.tools.map((tool) => [tool.id, tool]));
    }

    refresh(): void {
        for (const [button, tool] of this.buttons) {
            if (tool.isActive) button.setAttribute('aria-pressed', String(tool.isActive()));

            button.disabled = !this.editor.isEditable || (tool.isDisabled?.() ?? false);
        }

        if (this.moreButton) this.moreButton.disabled = !this.editor.isEditable;

        // The toolbar is one tab stop, and arrow keys move within it.
        const controls = this.controls();

        if (!controls.some((control) => control.tabIndex === 0 && !control.disabled)) {
            const first = controls.find((control) => !control.disabled);

            if (first) this.setTabStop(first);
        }

        if (!this.editor.isEditable && ['more', 'help'].includes(this.popovers.kind ?? '')) this.popovers.close(false);

        this.updateClip();
    }

    destroy(): void {
        this.resize?.disconnect();

        if (['more', 'help'].includes(this.popovers.kind ?? '')) this.popovers.close(false);
    }

    /**
     * In a narrow editor the bar scrolls, and a fade marks each side with more tools beyond it. The
     * classes name the physical side, since a right-to-left bar starts on the right and scrolls left.
     */
    updateClip(): void {
        const { scrollWidth, clientWidth, scrollLeft } = this.element;
        const scrolls = scrollWidth - clientWidth > 1 && getComputedStyle(this.element).overflowX !== 'visible';
        // Right to left, `scrollLeft` runs from 0 down to minus the overflow.
        const travelled = Math.abs(scrollLeft);
        const before = scrolls && travelled > 1;
        const after = scrolls && travelled < scrollWidth - clientWidth - 1;
        const rtl = scrolls && isRtl(this.element);

        this.element.classList.toggle('is-clipped-left', rtl ? after : before);
        this.element.classList.toggle('is-clipped-right', rtl ? before : after);
    }

    private controls(): HTMLButtonElement[] {
        return [...this.element.querySelectorAll<HTMLButtonElement>('button')];
    }

    private separator(): HTMLElement {
        const separator = element('span', 'verbb-editor__separator');

        separator.setAttribute('aria-hidden', 'true');

        return separator;
    }

    private button(tool: ToolDefinition): HTMLButtonElement {
        const button = iconButton(tool.icon, tool.label);

        button.dataset.command = tool.id;
        button.tabIndex = -1;

        if (tool.keys) {
            button.dataset.keys = displayShortcut(tool.keys);
            button.setAttribute('aria-keyshortcuts', ariaShortcut(tool.keys));
        } else if (tool.hint) {
            button.dataset.keys = tool.hint;
        }

        if (tool.isActive) button.setAttribute('aria-pressed', 'false');

        if (tool.popup) {
            button.setAttribute('aria-haspopup', tool.popup);
            button.setAttribute('aria-expanded', 'false');
        }

        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
            if (this.editor.isEditable) tool.run(button);
        });
        button.addEventListener('focus', () => this.setTabStop(button));
        this.buttons.set(button, tool);

        return button;
    }

    private setTabStop(active: HTMLButtonElement): void {
        for (const control of this.controls()) control.tabIndex = control === active ? 0 : -1;
    }

    private handleArrowKeys(event: KeyboardEvent): void {
        const controls = this.controls().filter((control) => !control.disabled);
        const current = controls.indexOf(document.activeElement as HTMLButtonElement);

        if (current < 0) return;

        let next: number;
        // The bar runs the other way in a right-to-left layout, so the arrows follow what's on screen.
        const forward = isRtl(this.element) ? 'ArrowLeft' : 'ArrowRight';
        const back = forward === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';

        if (event.key === forward) next = (current + 1) % controls.length;
        else if (event.key === back) next = (current - 1 + controls.length) % controls.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = controls.length - 1;
        else return;

        event.preventDefault();
        controls[next]?.focus();
    }

    private openMore(): void {
        const trigger = this.moreButton!;
        const popover = this.popovers.open('more', 'verbb-editor__pop--menu', { trigger });
        const menu = element('div', 'verbb-editor__menu');

        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', this.options.labels.more);

        for (const tool of this.moreTools) {
            if (!tool) {
                if (menu.lastElementChild && menu.lastElementChild.tagName !== 'HR') menu.append(element('hr'));
                continue;
            }

            const item = element('button', 'verbb-editor__option');

            item.type = 'button';
            item.tabIndex = -1;
            item.dataset.command = tool.id;
            item.setAttribute('role', tool.isActive ? 'menuitemcheckbox' : 'menuitem');

            if (tool.isActive) item.setAttribute('aria-checked', String(tool.isActive()));
            if (tool.isDisabled?.()) item.setAttribute('aria-disabled', 'true');

            item.append(icon(tool.icon), element('span', 'verbb-editor__option-text', tool.label));

            if (tool.keys || tool.hint) item.append(element('kbd', undefined, tool.keys ? displayShortcut(tool.keys) : tool.hint));

            item.addEventListener('click', () => {
                if (item.getAttribute('aria-disabled') === 'true') return;

                this.popovers.close(false);
                tool.run(trigger);
            });
            menu.append(item);
        }

        popover.append(menu);
        place(popover, this.root, trigger.getBoundingClientRect(), 'above');

        const items = [...menu.querySelectorAll<HTMLButtonElement>('button')];

        items[0]?.focus();
        menu.addEventListener('keydown', (event) => {
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            let next: number | null = null;

            if (event.key === 'ArrowDown') next = (index + 1) % items.length;
            else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = items.length - 1;

            if (next !== null) {
                event.preventDefault();
                items[next]?.focus();
            }
        });
    }

    private openHelp(trigger: HTMLElement): void {
        const { labels, features: f } = this.options;
        const popover = this.popovers.open('help', '', { trigger: trigger.isConnected ? trigger : this.moreButton });
        const help = element('div', 'verbb-editor__help');
        // Each table is named by a caption rather than a heading, so the help doesn't break the page's outline.
        const table = (caption: string, rows: [string, string][]) => {
            const body = element('table');

            body.append(element('caption', undefined, caption));

            rows.forEach(([name, keys]) => {
                const row = element('tr');

                row.append(element('td', undefined, name), element('td', undefined, keys));
                body.append(row);
            });

            return body;
        };

        const shortcuts = this.tools
            .filter((tool) => tool.keys && !INSERT_TOOLS.includes(tool.tool as EditorTool))
            .map((tool): [string, string] => [tool.label, displayShortcut(tool.keys!)]);

        const markdown: [string, string][] = [];

        if (f.bold) markdown.push([labels.bold, '**bold**']);
        if (f.italic) markdown.push([labels.italic, '_italic_']);
        if (f.strike) markdown.push([labels.strike, '~~strike~~']);
        if (f.code) markdown.push([labels.code, '`code`']);
        if (f.lists) markdown.push([labels.bulletList, formatLabel(labels.either, { first: '-', second: '*' })], [labels.orderedList, '1.']);
        if (f.blockquote) markdown.push([labels.blockquote, '>']);
        if (f.headings) markdown.push([formatLabel(labels.heading, { level: f.headings[0] }), `${'#'.repeat(f.headings[0])} `]);

        help.append(table(labels.shortcuts, [...shortcuts, ...this.actions.helpRows()]));

        if (markdown.length) help.append(table(labels.markdown, markdown));

        help.tabIndex = -1;
        help.setAttribute('role', 'dialog');
        help.setAttribute('aria-label', labels.formattingHelp);
        popover.append(help);
        place(popover, this.root, (this.moreButton ?? this.element).getBoundingClientRect(), 'above');
        help.focus();
    }

    private historyTools(): ToolDefinition[] {
        const { labels } = this.options;
        const chain = () => this.editor.chain().focus();

        return [
            { id: 'undo', tool: 'undo', icon: 'undo', label: labels.undo, keys: 'Mod-z', run: () => chain().undo().run(), isDisabled: () => !this.editor.can().undo() },
            { id: 'redo', tool: 'redo', icon: 'redo', label: labels.redo, keys: 'Mod-Shift-z', run: () => chain().redo().run(), isDisabled: () => !this.editor.can().redo() },
        ];
    }

    private helpTool(): ToolDefinition {
        return { id: 'help', tool: 'help', icon: 'help', label: this.options.labels.formattingHelp, run: (trigger) => this.openHelp(trigger) };
    }

    private definitions(): ToolDefinition[] {
        const { features: f, labels } = this.options;
        const chain = () => this.editor.chain().focus();
        const tools: ToolDefinition[] = [];
        const mark = (id: 'bold' | 'italic' | 'underline' | 'strike' | 'code', name: IconName, label: string, keys: string) => tools.push({
            id,
            tool: id,
            icon: name,
            label,
            keys,
            run: () => chain().toggleMark(id).run(),
            isActive: () => this.editor.isActive(id),
        });

        if (f.bold) mark('bold', 'bold', labels.bold, 'Mod-b');
        if (f.italic) mark('italic', 'italic', labels.italic, 'Mod-i');
        if (f.underline) mark('underline', 'underline', labels.underline, 'Mod-u');
        if (f.strike) mark('strike', 'strike', labels.strike, 'Mod-Shift-s');
        if (f.code) mark('code', 'code', labels.code, 'Mod-e');

        if (f.headings) {
            for (const level of f.headings) {
                tools.push({
                    id: `heading-${level}`,
                    tool: 'heading',
                    icon: 'heading',
                    label: formatLabel(labels.heading, { level }),
                    keys: `Mod-Alt-${level}`,
                    run: () => chain().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run(),
                    isActive: () => this.editor.isActive('heading', { level }),
                });
            }
        }

        if (f.lists) {
            tools.push({ id: 'bulletList', tool: 'bulletList', icon: 'bulletList', label: labels.bulletList, keys: 'Mod-Shift-8', run: () => chain().toggleBulletList().run(), isActive: () => this.editor.isActive('bulletList') });
            tools.push({ id: 'orderedList', tool: 'orderedList', icon: 'orderedList', label: labels.orderedList, keys: 'Mod-Shift-7', run: () => chain().toggleOrderedList().run(), isActive: () => this.editor.isActive('orderedList') });
        }

        if (f.blockquote) {
            tools.push({ id: 'blockquote', tool: 'blockquote', icon: 'blockquote', label: labels.blockquote, keys: 'Mod-Shift-b', run: () => chain().toggleBlockquote().run(), isActive: () => this.editor.isActive('blockquote') });
        }

        if (this.actions.canLink()) {
            tools.push({
                id: 'link',
                tool: 'link',
                icon: 'link',
                label: labels.link,
                keys: 'Mod-k',
                run: () => this.actions.openLink(),
                isActive: () => this.editor.isActive('link') || this.editor.isActive('craftLink'),
            });
        }

        if (this.actions.canMention()) {
            tools.push({
                id: 'mention',
                tool: 'mention',
                icon: 'mention',
                label: labels.mention,
                hint: '@',
                run: () => {
                    const { from } = this.editor.state.selection;
                    const before = from > 1 ? this.editor.state.doc.textBetween(from - 1, from, '\n', ' ') : '';

                    chain().insertContent(before && !/\s/.test(before) ? ' @' : '@').run();
                },
            });
        }

        if (this.actions.canAttach()) {
            const photos = this.actions.photosOnly();

            tools.push({ id: 'attach', tool: 'attach', icon: photos ? 'camera' : 'attach', label: photos ? labels.addPhotos : labels.attach, run: () => this.actions.pickFiles() });
        }

        if (this.actions.canGif()) {
            tools.push({ id: 'gif', tool: 'gif', icon: 'gif', label: labels.gifAdd, popup: 'dialog', run: (trigger) => this.actions.openGifs(trigger) });
        }

        return tools;
    }
}
