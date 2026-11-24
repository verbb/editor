import type { Editor as TiptapEditor } from '@tiptap/core';
import type { SelectionBookmark, Transaction } from '@tiptap/pm/state';

import { formatLabel } from '../../config/labels';
import { CraftClient } from '../../craft/Client';
import { EditorSetupError } from '../../craft/csrf';
import type { ElementSearchResult } from '../../craft/types';
import { normalizeLinkInput, safeUrl } from '../../core/urls';
import { element, iconButton, place, textButton, type Anchor } from '../dom';
import { icon } from '../icons';
import type { Popovers } from '../Popover';

import type { ResolvedEditorOptions } from '../../types';

interface LinkChoice {
    kind: 'address' | 'page';
    title: string;
    subtitle: string;
    href: string;
    page?: ElementSearchResult;
}

let linkId = 0;

// What reads as an address rather than words to search for: a scheme, an email, a domain or a path.
function looksLikeAddress(value: string): boolean {
    return /^[a-z][a-z\d+.-]*:\S+$/i.test(value)
        || /^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i.test(value)
        || /^(www\.)?[\w-]+(\.[\w-]+)*\.[a-z]{2,}([/?#:]\S*)?$/i.test(value)
        || /^(\/|\.\/|\.\.\/|#|\?)\S*$/.test(value);
}

/**
 * One Link control for web addresses and pages on the site, anchored to the words being linked. A
 * pasted address stores an ordinary link; a chosen page stores a Craft link reference, so it keeps
 * working if the page moves. Page search only appears when the context allows Craft links.
 */
export class LinkTools {
    private readonly client: CraftClient | null;
    private card: HTMLElement | null = null;

    constructor(
        private readonly editor: TiptapEditor,
        private readonly options: ResolvedEditorOptions,
        private readonly root: HTMLElement,
        private readonly popovers: Popovers,
    ) {
        const craft = options.craft;

        this.client = craft && options.features.craftLink && craft.endpoints?.elements ? new CraftClient(craft, options.labels, options.request) : null;
    }

    available(): boolean {
        return this.options.features.link || !!this.client;
    }

    /** Opens the link popover for the selection, or for the link around the caret. */
    open(): void {
        if (!this.available() || !this.editor.isEditable) return;

        this.hideCard();

        const { labels } = this.options;
        const existingMark = this.editor.isActive('craftLink') ? 'craftLink' : this.editor.isActive('link') ? 'link' : null;
        const existing = existingMark ? this.editor.getAttributes(existingMark) : null;

        if (existingMark) this.editor.commands.extendMarkRange(existingMark);

        let bookmark: SelectionBookmark = this.editor.state.selection.getBookmark();
        const empty = this.editor.state.selection.empty;
        const anchor = this.selectionAnchor();
        const map = ({ transaction }: { transaction: Transaction }) => {
            bookmark = bookmark.map(transaction.mapping);
        };
        let controller: AbortController | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let choices: LinkChoice[] = [];
        let selected = 0;
        let pages: ElementSearchResult[] | null = null;
        let pageQuery: string | null = null;
        let failed = false;

        this.editor.on('transaction', map);

        const popover = this.popovers.open('link', 'verbb-editor__pop--link', {
            onClose: () => {
                this.editor.off('transaction', map);
                clearTimeout(timer);
                controller?.abort();
            },
        });
        const id = `verbb-editor-link-${++linkId}`;
        const field = element('div', 'verbb-editor__pop-field');
        const input = element('input');
        const body = element('div', 'verbb-editor__pop-body');
        const list = element('div', 'verbb-editor__pop-list');
        const foot = element('div', 'verbb-editor__pop-foot');

        input.type = 'text';
        input.autocomplete = 'off';
        input.placeholder = this.client ? labels.linkPrompt : labels.linkPromptAddress;
        input.setAttribute('aria-label', labels.linkAddress);
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-expanded', 'true');
        input.setAttribute('aria-controls', id);
        input.value = existingMark === 'link' ? String(existing?.href ?? '') : existingMark === 'craftLink' ? String(existing?.label ?? '') : '';
        list.id = id;
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', labels.link);
        field.append(icon('search'), input);
        body.append(list);

        if (existingMark) {
            const remove = textButton(labels.removeLink, 'verbb-editor__button verbb-editor__button--danger', 'unlink');

            remove.addEventListener('click', () => {
                if (this.restore(bookmark)) this.editor.chain().focus().extendMarkRange(existingMark).unsetMark(existingMark).run();

                this.popovers.close(false);
            });
            foot.append(remove);
        } else {
            foot.append(element('span', 'verbb-editor__grow', this.client ? labels.pageLinksKeep : ''));
        }

        foot.append(element('span', undefined, labels.enterToAdd));
        popover.append(field, body, foot);

        const apply = (choice: LinkChoice) => {
            if (!this.restore(bookmark)) return;

            const mark = choice.kind === 'page' && choice.page
                ? { type: 'craftLink', attrs: { id: choice.page.id, type: choice.page.type, label: choice.page.label, href: choice.page.url } }
                : { type: 'link', attrs: { href: choice.href } };

            if (empty) {
                this.editor.chain().focus().insertContent([{ type: 'text', text: choice.title, marks: [mark] }, { type: 'text', text: ' ' }]).run();
            } else {
                this.editor.chain().focus().setMark(mark.type, mark.attrs).run();
            }

            this.popovers.close(false);
        };

        const highlight = () => {
            list.querySelectorAll<HTMLElement>('[role="option"]').forEach((option, index) => option.setAttribute('aria-selected', String(index === selected)));

            if (choices.length) input.setAttribute('aria-activedescendant', `${id}-${selected}`);
            else input.removeAttribute('aria-activedescendant');
        };

        const draw = () => {
            const value = input.value.trim();
            const address = value && looksLikeAddress(value) ? safeUrl(normalizeLinkInput(value)) : '';

            choices = [];

            if (address) choices.push({ kind: 'address', title: value, subtitle: labels.webAddress, href: address });

            for (const page of pages ?? []) {
                choices.push({ kind: 'page', title: page.label, subtitle: [page.description, page.url.replace(/^https?:\/\/[^/]+/, '') || '/'].filter(Boolean).join(' · '), href: page.url, page });
            }

            list.replaceChildren();
            body.querySelector('.verbb-editor__pop-message')?.remove();
            body.querySelector('.verbb-editor__pop-group')?.remove();
            selected = Math.min(selected, Math.max(0, choices.length - 1));

            if (pages?.length) {
                const group = element('div', 'verbb-editor__pop-group', value && pageQuery ? labels.pages : labels.suggestedPages);

                body.insertBefore(group, list);
            }

            choices.forEach((choice, index) => {
                const option = element('div', 'verbb-editor__option');
                const glyph = element('span', 'verbb-editor__option-icon');
                const text = element('span', 'verbb-editor__option-text');

                option.id = `${id}-${index}`;
                option.setAttribute('role', 'option');
                glyph.append(icon(choice.kind === 'address' ? 'globe' : 'page'));
                text.append(element('b', undefined, choice.kind === 'address' ? formatLabel(labels.linkTo, { address: choice.title }) : choice.title), element('span', undefined, choice.subtitle));
                option.append(glyph, text);
                option.addEventListener('mousedown', (event) => event.preventDefault());
                option.addEventListener('click', () => apply(choice));
                list.append(option);
            });

            if (!choices.length) {
                let title = '';
                let hint = '';

                if (failed) {
                    hint = labels.pagesFailed;
                } else if (value && this.client && pages !== null && pageQuery === value) {
                    title = formatLabel(labels.noPages, { query: value });
                    hint = labels.noPagesHint;
                } else if (value && !this.client && input.getAttribute('aria-invalid') === 'true') {
                    hint = labels.invalidUrl;
                } else if (value && this.client) {
                    hint = labels.searching;
                }

                if (title || hint) {
                    const message = element('div', `verbb-editor__pop-message${failed ? ' is-failed' : ''}`);
                    const text = element('div');

                    message.setAttribute('role', 'status');

                    if (title) text.append(element('b', undefined, title));

                    text.append(element('span', undefined, hint));
                    message.append(icon(failed ? 'alert' : 'search'), text);
                    body.append(message);
                }
            }

            highlight();
        };

        // Words search the site's pages; an empty field asks for suggestions.
        const search = () => {
            const value = input.value.trim();

            clearTimeout(timer);
            controller?.abort();
            failed = false;

            if (!this.client || looksLikeAddress(value) || (value.length === 1 && pages !== null)) {
                if (looksLikeAddress(value)) pages = [];

                draw();

                return;
            }

            const current = new AbortController();

            controller = current;
            timer = setTimeout(async () => {
                try {
                    const results = await this.client!.searchElements(value, { signal: current.signal });

                    if (current.signal.aborted || !popover.isConnected) return;

                    pages = results;
                    pageQuery = value;
                } catch (error) {
                    if (current.signal.aborted) return;

                    if (error instanceof EditorSetupError) console.error(error.message);

                    pages = [];
                    failed = true;
                }

                draw();
            }, value ? 180 : 0);

            draw();
        };

        input.addEventListener('input', () => {
            selected = 0;
            input.removeAttribute('aria-invalid');
            search();
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown' && choices.length) {
                event.preventDefault();
                selected = (selected + 1) % choices.length;
                highlight();
            } else if (event.key === 'ArrowUp' && choices.length) {
                event.preventDefault();
                selected = (selected - 1 + choices.length) % choices.length;
                highlight();
            } else if (event.key === 'Enter') {
                // The popover sits inside the host's form, where Enter would otherwise submit it unsaved.
                event.preventDefault();

                if (choices[selected]) {
                    apply(choices[selected]);
                } else if (input.value.trim()) {
                    input.setAttribute('aria-invalid', 'true');
                    draw();
                }
            }
        });

        search();
        place(popover, this.root, anchor);
        input.focus();
        input.select();
    }

    /** The small card under a link the caret is in: where it goes, edit and remove. */
    updateCard(): void {
        const { state } = this.editor;
        const mark = this.editor.isActive('craftLink') ? 'craftLink' : this.editor.isActive('link') ? 'link' : null;

        if (!mark || !state.selection.empty || !this.editor.isFocused || this.popovers.kind) {
            this.hideCard();

            return;
        }

        const { labels } = this.options;
        const attrs = this.editor.getAttributes(mark);
        const href = safeUrl(attrs.href);
        const title = mark === 'craftLink' ? String(attrs.label ?? href) : href.replace(/^mailto:/, '').replace(/^https?:\/\//, '').replace(/\/$/, '');

        if (!this.card) {
            this.card = element('div', 'verbb-editor__pop verbb-editor__link-card');
            this.card.addEventListener('mousedown', (event) => {
                if (!(event.target as HTMLElement).closest('a')) event.preventDefault();
            });
            this.root.append(this.card);
        }

        const link = element('a');
        const edit = iconButton('pencil', labels.editLink);
        const remove = iconButton('unlink', labels.removeLink);

        link.append(icon(mark === 'craftLink' ? 'page' : 'globe'), element('span', undefined, title || href));

        if (href) {
            link.href = href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.title = labels.openLink;
        }

        edit.tabIndex = -1;
        remove.tabIndex = -1;
        edit.addEventListener('click', () => this.open());
        remove.addEventListener('click', () => {
            this.editor.chain().focus().extendMarkRange(mark).unsetMark(mark).run();
            this.hideCard();
        });
        this.card.replaceChildren(link, edit, remove);

        const coords = this.editor.view.coordsAtPos(state.selection.from);

        place(this.card, this.root, { left: coords.left - 12, right: coords.left + 12, top: coords.top, bottom: coords.bottom });
    }

    hideCard(): void {
        this.card?.remove();
        this.card = null;
    }

    destroy(): void {
        this.hideCard();

        if (this.popovers.kind === 'link') this.popovers.close(false);
    }

    private restore(bookmark: SelectionBookmark): boolean {
        if (!this.editor.isEditable) return false;

        this.editor.view.dispatch(this.editor.state.tr.setSelection(bookmark.resolve(this.editor.state.doc)));

        return true;
    }

    private selectionAnchor(): Anchor {
        const { from, to } = this.editor.state.selection;
        const start = this.editor.view.coordsAtPos(from);
        const end = this.editor.view.coordsAtPos(to);

        return { left: start.left, right: start.right, top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom) };
    }
}
