import type { Editor as TiptapEditor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

import { ariaShortcut, displayShortcut, element, iconButton, isTouch } from '../dom';
import type { ToolDefinition } from './Toolbar';

const BUBBLE_TOOLS = ['bold', 'italic', 'strike', 'code'];

/**
 * The common marks floating above a text selection, so the toolbar can stay short. Off on touch
 * screens, which show their own selection menus.
 */
export class Bubble {
    private element: HTMLElement | null = null;
    private readonly buttons = new Map<HTMLButtonElement, ToolDefinition>();

    constructor(
        private readonly editor: TiptapEditor,
        private readonly root: HTMLElement,
        private readonly label: string,
        private readonly tools: () => Map<string, ToolDefinition>,
        private readonly blocked: () => boolean,
    ) {}

    update(): void {
        const { selection } = this.editor.state;

        if (!this.editor.isFocused || !this.editor.isEditable || selection.empty || !(selection instanceof TextSelection) || this.blocked() || isTouch()) {
            this.hide();

            return;
        }

        const definitions = this.tools();
        const marks = BUBBLE_TOOLS.map((id) => definitions.get(id)).filter((tool): tool is ToolDefinition => !!tool);
        const link = definitions.get('link');

        if (!marks.length && !link) return;

        if (!this.element) {
            this.element = element('div', 'verbb-editor__bubble');
            this.element.setAttribute('role', 'toolbar');
            this.element.setAttribute('aria-label', this.label);
            this.element.addEventListener('mousedown', (event) => event.preventDefault());

            for (const tool of marks) this.element.append(this.button(tool));

            if (link) {
                if (marks.length) this.element.append(element('span', 'verbb-editor__separator'));

                this.element.append(this.button(link));
            }

            this.root.append(this.element);
        }

        for (const [button, tool] of this.buttons) {
            if (tool.isActive) button.setAttribute('aria-pressed', String(tool.isActive()));
        }

        this.position();
    }

    hide(): void {
        this.element?.remove();
        this.element = null;
        this.buttons.clear();
    }

    private button(tool: ToolDefinition): HTMLButtonElement {
        const button = iconButton(tool.icon, tool.label);

        button.tabIndex = -1;

        if (tool.keys) {
            button.dataset.keys = displayShortcut(tool.keys);
            button.setAttribute('aria-keyshortcuts', ariaShortcut(tool.keys));
        }

        if (tool.isActive) button.setAttribute('aria-pressed', 'false');

        button.addEventListener('click', () => {
            tool.run(button);
            this.update();
        });
        this.buttons.set(button, tool);

        return button;
    }

    private position(): void {
        if (!this.element) return;

        const { from, to } = this.editor.state.selection;
        const start = this.editor.view.coordsAtPos(from);
        const end = this.editor.view.coordsAtPos(to);
        const bounds = this.root.getBoundingClientRect();
        const width = this.element.offsetWidth;
        const height = this.element.offsetHeight;
        const top = Math.min(start.top, end.top);
        const centre = (start.left + end.left) / 2 - bounds.left;
        const below = top - height - 10 < 0;
        const left = Math.max(4, Math.min(bounds.width - width - 4, centre - width / 2));

        this.element.classList.toggle('is-below', below);
        this.element.style.left = `${left}px`;
        this.element.style.top = `${(below ? Math.max(start.bottom, end.bottom) + 10 : top - height - 10) - bounds.top}px`;
        this.element.style.setProperty('--verbb-editor-arrow', `${Math.max(12, Math.min(width - 12, centre - left))}px`);
    }
}
