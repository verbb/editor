import Mention, { type MentionOptions } from '@tiptap/extension-mention';

import { formatLabel } from '../../config/labels';
import { EditorSetupError } from '../../craft/csrf';
import { element, isRtl, textButton } from '../../ui/dom';
import { icon } from '../../ui/icons';

import type { CraftClient } from '../../craft/Client';
import type { MentionSearchResult } from '../../craft/types';
import type { ResolvedEditorOptions } from '../../types';

let menuId = 0;

// Avatars without a photo get initials on one of eight token colours, chosen from the person's ID
// so it stays stable. The `craft` theme maps them to the Control Panel's palette.
const AVATAR_COLOURS = 8;

export function avatar(item: { id: number; label: string; imageUrl?: string }): HTMLElement {
    const badge = element('span', 'verbb-editor__avatar');

    if (item.imageUrl) {
        const image = element('img');

        image.src = item.imageUrl;
        image.alt = '';
        badge.append(image);
    } else {
        badge.textContent = item.label.split(/\s+/).filter(Boolean).map((word) => word[0]).slice(0, 2).join('').toUpperCase();
        badge.dataset.colour = String((Math.abs(item.id) % AVATAR_COLOURS) + 1);
    }

    badge.setAttribute('aria-hidden', 'true');

    return badge;
}

export function createMentionExtension(client: CraftClient | null, options: ResolvedEditorOptions) {
    const { labels } = options;
    const minQueryLength = (options.craft ? options.craft.minQueryLength : undefined) ?? 1;

    return Mention.extend<MentionOptions<MentionSearchResult, MentionSearchResult>>({
        parseHTML() {
            return [{ tag: 'span[data-mention-id]' }, { tag: 'span[data-type="mention"]' }];
        },
        addAttributes() {
            return {
                id: { default: null, parseHTML: (element) => Number(element.getAttribute('data-mention-id') ?? element.getAttribute('data-id')) || null },
                type: { default: null, parseHTML: (element) => element.getAttribute('data-mention-type'), renderHTML: (attrs) => ({ 'data-mention-type': attrs.type }) },
                label: { default: null, parseHTML: (element) => element.getAttribute('data-label') ?? element.getAttribute('label'), renderHTML: (attrs) => ({ 'data-label': attrs.label }) },
            };
        },
    }).configure({
        HTMLAttributes: { class: 'verbb-editor-mention' },
        renderHTML: ({ node }) => ['span', {
            class: 'verbb-editor-mention',
            'data-type': 'mention',
            'data-mention-id': node.attrs.id,
            'data-mention-type': node.attrs.type,
            'data-label': node.attrs.label,
        }, `@${node.attrs.label ?? node.attrs.id}`],
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
        suggestion: {
            char: '@',
            // Only while the author is typing here, so a restored draft ending in "@name" stays quiet.
            allow: ({ editor }) => !!client && options.features.mention && editor.isFocused,
            // Own the async search in the renderer so late responses cannot replace a newer query.
            items: () => [],
            command: ({ editor, range, props }) => {
                // Only the reference is stored. A description or image is for choosing, not saving.
                editor.chain().focus().insertContentAt(range, [
                    { type: 'mention', attrs: { id: props.id, type: props.type, label: props.label } },
                    { type: 'text', text: ' ' },
                ]).run();
            },
            render: () => {
                let menu: HTMLDivElement | null = null;
                let body: HTMLDivElement | null = null;
                let list: HTMLDivElement | null = null;
                let status: HTMLDivElement | null = null;
                let textbox: HTMLElement | null = null;
                let controller: AbortController | undefined;
                let timer: ReturnType<typeof setTimeout> | undefined;
                let items: MentionSearchResult[] = [];
                let idle: MentionSearchResult[] | null = null;
                let query = '';
                let selected = 0;
                let searching = false;
                let dismissed = false;
                let choose: (item: MentionSearchResult) => void;
                let rect: (() => DOMRect | null) | null | undefined;
                const id = `verbb-editor-mentions-${++menuId}`;

                // Keeps the menu on screen: flipped above the caret near the bottom of the viewport,
                // and shortened only when neither side has room for it.
                const position = () => {
                    const caret = rect?.();
                    const root = menu?.parentElement?.getBoundingClientRect();

                    if (!caret || !root || !menu) return;

                    menu.style.maxHeight = '';

                    const height = menu.offsetHeight;
                    const below = window.innerHeight - caret.bottom - 8;
                    const above = caret.top - 8;
                    const flip = height > below && above > below;

                    if (height > Math.max(below, above)) menu.style.maxHeight = `${Math.max(below, above)}px`;

                    const placed = menu.offsetHeight;

                    // Lined up with where the "@" starts: its right edge in a right-to-left layout.
                    const start = menu.parentElement && isRtl(menu.parentElement) ? caret.right - menu.offsetWidth : caret.left;

                    menu.style.left = `${Math.max(0, Math.min(start - root.left, root.width - menu.offsetWidth))}px`;
                    menu.style.top = `${(flip ? caret.top - placed - 4 : caret.bottom + 4) - root.top}px`;
                };

                const highlight = () => {
                    list?.querySelectorAll<HTMLElement>('[role="option"]').forEach((node, index) => {
                        const isSelected = index === selected;

                        node.setAttribute('aria-selected', String(isSelected));

                        if (isSelected) node.scrollIntoView?.({ block: 'nearest' });
                    });

                    if (items.length) textbox?.setAttribute('aria-activedescendant', `${id}-${selected}`);
                    else textbox?.removeAttribute('aria-activedescendant');
                };

                const cancel = () => {
                    clearTimeout(timer);
                    controller?.abort();
                    searching = false;
                };

                const close = () => {
                    cancel();
                    textbox?.removeEventListener('blur', dismiss);
                    menu?.remove();
                    menu = null;
                    body = null;
                    list = null;
                    status = null;
                    items = [];
                    idle = null;
                    textbox?.removeAttribute('aria-controls');
                    textbox?.removeAttribute('aria-activedescendant');
                    window.removeEventListener('resize', position);
                    document.removeEventListener('scroll', position, true);
                };

                // Dismissed stays set until the suggestion ends, so typing on doesn't reopen the menu or keep searching.
                const dismiss = () => {
                    dismissed = true;
                    close();
                };

                /** A short message instead of results: a hint, no matches, or a failure with a retry. */
                const message = (title: string, hint = '', retry = false) => {
                    items = [];
                    list?.replaceChildren();
                    highlight();

                    if (!status || !body) return;

                    status.replaceChildren();
                    status.className = `verbb-editor__suggestions-status${retry ? ' is-failed' : ''}`;

                    if (title) {
                        const text = element('div');

                        text.append(element('b', undefined, title));

                        if (hint) text.append(element('span', undefined, hint));

                        status.append(icon(retry ? 'alert' : 'mention'), text);
                    } else if (hint) {
                        // A hint alone, such as "Keep typing to search.", stays a quiet line.
                        status.textContent = hint;
                    }

                    body.querySelector('.verbb-editor__pop-foot')?.remove();

                    if (retry) {
                        const foot = element('div', 'verbb-editor__pop-foot');
                        const again = textButton(labels.tryAgain, 'verbb-editor__button', 'retry');

                        again.addEventListener('mousedown', (event) => event.preventDefault());
                        again.addEventListener('click', () => search(query, true));
                        foot.append(element('span', 'verbb-editor__grow'), again);
                        body.append(foot);
                    }

                    position();
                };

                const show = (results: MentionSearchResult[], heading: string) => {
                    items = results;
                    selected = 0;

                    if (!list || !status || !body) return;

                    status.replaceChildren();
                    status.className = 'verbb-editor__suggestions-status';
                    status.append(element('span', 'verbb-editor__pop-group', heading));
                    list.replaceChildren();
                    items.forEach((item, index) => {
                        const option = element('div', 'verbb-editor__suggestion');
                        const text = element('span', 'verbb-editor__option-text');

                        option.id = `${id}-${index}`;
                        option.setAttribute('role', 'option');
                        option.setAttribute('aria-label', item.description ? `${item.label}, ${item.description}` : item.label);
                        text.append(element('b', undefined, item.label));

                        if (item.description) text.append(element('span', undefined, item.description));

                        option.append(avatar(item), text);
                        option.addEventListener('mousedown', (event) => {
                            event.preventDefault();
                            choose(item);
                        });
                        list?.append(option);
                    });

                    body.querySelector('.verbb-editor__pop-foot')?.remove();

                    const foot = element('div', 'verbb-editor__pop-foot');

                    foot.append(element('span', 'verbb-editor__grow', labels.mentionKeys), element('span', undefined, 'esc'));
                    body.append(foot);
                    highlight();
                    position();
                };

                const fail = (error: unknown) => {
                    // A setup mistake is the developer's to fix, so it goes to the console, not the author.
                    if (error instanceof EditorSetupError) console.error(error.message);

                    message(labels.mentionFailed, labels.mentionFailedHint, true);
                };

                const request = (value: string, onResults: (results: MentionSearchResult[]) => void) => {
                    searching = true;

                    const current = new AbortController();

                    controller = current;
                    timer = setTimeout(async () => {
                        try {
                            const results = await client?.searchMentions(value, { signal: current.signal }) ?? [];

                            if (current.signal.aborted || !list) return;

                            searching = false;
                            onResults(results);
                        } catch (error) {
                            if (current.signal.aborted) return;

                            searching = false;
                            fail(error);
                        }
                    }, value ? 180 : 0);
                };

                // An empty query asks for suggestions, which a context may or may not give.
                const search = (value: string, retry = false) => {
                    cancel();
                    query = value;

                    const trimmed = value.trim();

                    if (!trimmed) {
                        if (idle && !retry) {
                            if (idle.length) show(idle, labels.mentionIdle);
                            else message('', labels.mentionHint);

                            return;
                        }

                        message('', labels.searching);
                        request('', (results) => {
                            idle = results;

                            if (results.length) show(results, labels.mentionIdle);
                            else message('', labels.mentionHint);
                        });

                        return;
                    }

                    if (trimmed.length < minQueryLength) {
                        const lower = trimmed.toLowerCase();
                        const matches = (idle ?? []).filter((item) => item.label.toLowerCase().split(/\s+/).some((word) => word.startsWith(lower)));

                        if (matches.length) show(matches, labels.mentionIdle);
                        else message('', labels.mentionHint);

                        return;
                    }

                    message('', labels.searching);
                    request(value, (results) => {
                        if (results.length) show(results, labels.mentionPeople);
                        else message(formatLabel(labels.mentionNone, { query: trimmed }), labels.mentionPlain);
                    });
                };

                return {
                    onStart: (props) => {
                        dismissed = false;
                        textbox = props.editor.view.dom;

                        menu = element('div', 'verbb-editor__suggestions verbb-editor__pop verbb-editor__pop--sm');
                        body = element('div', 'verbb-editor__suggestions-body');

                        // A status can't sit inside a listbox, so the menu holds them side by side.
                        status = element('div', 'verbb-editor__suggestions-status');
                        status.setAttribute('role', 'status');

                        list = element('div');
                        list.id = id;
                        list.setAttribute('role', 'listbox');
                        list.setAttribute('aria-label', labels.mentionSuggestions);

                        body.append(status, list);
                        menu.append(body);
                        menu.addEventListener('mousedown', (event) => event.preventDefault());
                        textbox.closest('.verbb-editor')?.append(menu);
                        textbox.setAttribute('aria-controls', id);
                        textbox.addEventListener('blur', dismiss);

                        choose = props.command;
                        rect = props.clientRect;
                        search(props.query);
                        position();
                        window.addEventListener('resize', position);
                        document.addEventListener('scroll', position, true);
                    },
                    onUpdate: (props) => {
                        if (dismissed) return;

                        choose = props.command;
                        rect = props.clientRect;

                        if (props.query !== query) search(props.query);

                        position();
                    },
                    onKeyDown: ({ event }) => {
                        if (!menu) return false;

                        if (event.key === 'Escape') {
                            // Closing the list is all Escape does, so a host dialog around the editor stays open.
                            event.stopPropagation();
                            dismiss();

                            return true;
                        }

                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            if (items.length) selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;

                            highlight();

                            return true;
                        }

                        if (event.key === 'Enter' || (event.key === 'Tab' && items.length)) {
                            if (items[selected]) {
                                choose(items[selected]);

                                return true;
                            }

                            // Otherwise Enter would abandon the mention and start a new paragraph mid-search.
                            return searching;
                        }

                        return false;
                    },
                    onExit: () => {
                        dismissed = false;
                        close();
                    },
                };
            },
        },
    });
}
