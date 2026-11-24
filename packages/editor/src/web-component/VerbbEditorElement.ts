import { Extension } from '@tiptap/core';

import { formatLabel } from '../config/labels';
import { normalizeContent } from '../core/document';
import { chromeOf, type EditorChrome } from '../internal';
import { displayShortcut, element, iconButton } from '../ui/dom';
import { icon } from '../ui/icons';
import { VerbbEditorInputElement } from './VerbbEditorInputElement';

import { normalizeGif } from '../config/normalizeOptions';

import type { EditorContent, EditorGif } from '../types';

const SLOTS = ['header', 'above', 'actions', 'footer'] as const;
const DRAFT_PREFIX = 'verbb-editor-draft:';
const DRAFT_VERSION = 1;
// Craft's garbage collection removes uploads after a day, so a draft's older uploads are gone.
const UPLOAD_LIFETIME = 23 * 60 * 60 * 1000;

type Slot = typeof SLOTS[number];

interface StoredDraft {
    version: number;
    savedAt: number;
    content: EditorContent;
    uploadTimes: Record<number, number>;
    gif?: EditorGif | null;
}

function readDraft(key: string): StoredDraft | null {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(DRAFT_PREFIX + key) ?? 'null');

        if (!parsed || typeof parsed !== 'object') return null;

        const draft = parsed as Partial<StoredDraft>;

        if (draft.version !== DRAFT_VERSION || typeof draft.savedAt !== 'number' || !Array.isArray(draft.content)) return null;

        return { version: DRAFT_VERSION, savedAt: draft.savedAt, content: normalizeContent(draft.content), uploadTimes: draft.uploadTimes && typeof draft.uploadTimes === 'object' ? draft.uploadTimes : {}, gif: normalizeGif(draft.gif) };
    } catch {
        return null;
    }
}

function writeDraft(key: string, draft: StoredDraft | null): void {
    try {
        if (draft) localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(draft));
        else localStorage.removeItem(DRAFT_PREFIX + key);
    } catch {
        // Storage can be full or blocked; the editor still works without drafts.
    }
}

function relativeTime(timestamp: number): string {
    // At least a minute, so a draft from a moment ago doesn't read as "from now".
    const minutes = Math.min(-1, Math.round((timestamp - Date.now()) / 60000));
    let format: Intl.RelativeTimeFormat;

    // Some sites set a `lang` that isn't a valid language tag, such as `en_US`.
    try {
        format = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: 'auto' });
    } catch {
        format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    }

    if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
    if (Math.abs(minutes) < 60 * 24) return format.format(Math.round(minutes / 60), 'hour');

    return format.format(Math.round(minutes / (60 * 24)), 'day');
}

/**
 * The editor: the editor input in a frame with a reply chip and header slot for context, an `above`
 * slot for a host's own fields that come before the text, an actions slot, a footer slot for a host's
 * own fields and attachments after it, a character limit, a local draft, post errors and ⌘↵. It's
 * form-associated, so `name`, `required`, reset and disabled work as they do for any field.
 */
/** Whether a form control's value differs from the one it was drawn with. */
function changedControl(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean {
    if (control instanceof HTMLSelectElement) {
        const options = [...control.options];

        // A single select with nothing marked selected starts on its first option.
        if (!control.multiple) return control.selectedIndex !== Math.max(0, options.findIndex((option) => option.defaultSelected));

        return options.some((option) => option.selected !== option.defaultSelected);
    }
    if (control instanceof HTMLTextAreaElement) return control.value !== control.defaultValue;
    if (['hidden', 'button', 'submit', 'reset', 'image'].includes(control.type)) return false;
    if (control.type === 'checkbox' || control.type === 'radio') return control.checked !== control.defaultChecked;
    if (control.type === 'file') return (control.files?.length ?? 0) > 0;

    return control.value !== control.defaultValue;
}

export class VerbbEditorElement extends VerbbEditorInputElement {
    static get observedAttributes(): string[] {
        return [...super.observedAttributes, 'submit-label', 'limit', 'draft-key', 'enter-submits', 'bare', 'collapsible', 'busy', 'reply-to'];
    }

    private _slotted: Record<Slot, Node[]> = { header: [], above: [], actions: [], footer: [] };
    private _regions: Partial<Record<Slot, HTMLElement>> = {};
    private _box: HTMLElement | null = null;
    private _reply: HTMLElement | null = null;
    private _meta: HTMLElement | null = null;
    private _status: HTMLElement | null = null;
    private _count: HTMLElement | null = null;
    private _submit: HTMLButtonElement | null = null;
    private _observer: MutationObserver | null = null;
    private _draftTimer: ReturnType<typeof setTimeout> | undefined;
    private _fadeTimer: ReturnType<typeof setTimeout> | undefined;
    private _draftState: 'saved' | 'faded' | null = null;
    private _collapseTimer: ReturnType<typeof setTimeout> | undefined;
    private _outsidePress: ((event: PointerEvent) => void) | null = null;
    // Open from when focus comes in until it moves elsewhere on the page or someone presses outside,
    // so focus that goes nowhere, such as a press on a field's instructions, never collapses it.
    private _open = false;
    /** Where the text stands against the limit, so crossing into the last stretch or over it is announced once. */
    private _limitState: 'ok' | 'warn' | 'over' | null = null;

    private readonly _afterSubmit = (event: Event) => {
        // A submission nothing cancelled is leaving the page with the document, so the draft is done.
        if (event.target === this.form && !event.defaultPrevented) this.clearDraft();
    };

    connectedCallback(): void {
        super.connectedCallback();
        window.addEventListener('submit', this._afterSubmit);
    }

    disconnectedCallback(): void {
        window.removeEventListener('submit', this._afterSubmit);
        super.disconnectedCallback();
    }

    /**
     * Opens a collapsible frame straight away. The text takes focus a frame later, as Tiptap focuses,
     * so waiting for its focus would draw the frame collapsed for a frame first.
     */
    override focus(): void {
        const chrome = this._chrome();

        if (chrome) {
            this._open = true;
            clearTimeout(this._collapseTimer);
            chrome.root.classList.remove('is-collapsed');
        }

        super.focus();
    }

    attributeChangedCallback(name: string): void {
        if (!this.isConnected || !this._editor) return;

        if (name === 'submit-label' || name === 'enter-submits') {
            this._renderSubmit();
            this._renderState();

            return;
        }

        if (name === 'busy') {
            this._sync();
            this._renderSubmit();

            if (this._isBusy()) this._announce(this._labelSet().posting);

            return;
        }

        if (name === 'reply-to') {
            this._renderReply();
            this._renderState();

            return;
        }

        if (['limit', 'draft-key', 'bare', 'collapsible'].includes(name)) {
            this._renderState();

            return;
        }

        super.attributeChangedCallback(name);
    }

    /**
     * Submits as the editor's own Post button does: nothing happens while it's empty, too long or
     * uploading. An `editor-submit` event comes first and can be cancelled; then the form submits.
     */
    requestSubmit(): void {
        if (!this._editor || this._isBusy()) return;

        const reason = this._blocker();

        if (reason) {
            this._announce(reason);

            const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

            if (!still) this._submit?.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 220 });

            return;
        }

        this._chrome()?.notice.clear('post');

        const proceed = this.dispatchEvent(new CustomEvent('editor-submit', { detail: { value: this.value, json: this.json }, bubbles: true, cancelable: true }));

        if (proceed) this.form?.requestSubmit();
    }

    /** Shows that posting failed, with the text kept and Try again a click away. The notice announces it. */
    showPostError(message?: string): void {
        const labels = this._labelSet();

        this._chrome()?.notice.show('bad', message || labels.postFailed, [{ label: labels.tryAgain, run: () => this.requestSubmit() }], 'post');
    }

    clearPostError(): void {
        this._chrome()?.notice.clear('post');
    }

    clearDraft(): void {
        clearTimeout(this._draftTimer);

        const key = this.getAttribute('draft-key');

        if (key) writeDraft(key, null);

        this._draftState = null;
        this._chrome()?.notice.clear('draft');
        this._renderState();
    }

    formResetCallback(): void {
        this.clearDraft();
        this.clearPostError();
        super.formResetCallback();
    }

    protected override _isBusy(): boolean {
        return this.hasAttribute('busy');
    }

    protected override _customValidity(): string {
        const over = this._over();

        return over > 0 ? formatLabel(this._labelSet().tooLong, { count: over }) : '';
    }

    protected override _editorOptions(): Record<string, unknown> {
        const editorElement = this;
        const labels = this._labelSet();

        return {
            keymap: Extension.create({
                name: 'verbbEditorKeys',
                // Ahead of Enter's usual handling, so a messaging host can send with it.
                priority: 1000,
                addKeyboardShortcuts() {
                    return {
                        'Mod-Enter': () => {
                            editorElement.requestSubmit();

                            return true;
                        },
                        Enter: () => {
                            if (!editorElement.hasAttribute('enter-submits')) return false;

                            // An open mention list owns the textbox's `aria-controls` and keeps Enter for
                            // choosing, as lists and code blocks keep it for a new line.
                            if (this.editor.view.dom.hasAttribute('aria-controls')) return false;
                            if (this.editor.isActive('listItem') || this.editor.isActive('codeBlock')) return false;

                            editorElement.requestSubmit();

                            return true;
                        },
                    };
                },
            }),
            helpRows: (): [string, string][] => {
                const enter = editorElement.hasAttribute('enter-submits');
                const rows: [string, string][] = [[editorElement.getAttribute('submit-label') || labels.submit, enter ? '↵' : displayShortcut('Mod-Enter')]];

                if (enter) rows.push([labels.newLine, displayShortcut('Shift-Enter')]);

                return rows;
            },
        };
    }

    protected override _mount(): void {
        if (this._editor) return;

        // Until its features load, the base class waits and calls this again, and the frame waits too.
        if (!this._featuresLoaded()) {
            super._mount();

            return;
        }

        this._collectSlots();
        super._mount();
        this._buildFrame();
        this._restoreDraft();
    }

    protected override _dispose(): void {
        clearTimeout(this._draftTimer);
        clearTimeout(this._fadeTimer);
        clearTimeout(this._collapseTimer);
        if (this._outsidePress) document.removeEventListener('pointerdown', this._outsidePress);
        this._outsidePress = null;
        this._observer?.disconnect();
        this._observer = null;
        this._limitState = null;
        // A remount draws a new frame, with its own Post button.
        this._submit = null;
        super._dispose();
    }

    protected override _afterSync(): void {
        this._renderState();
        this._scheduleDraft();
    }

    private _chrome(): EditorChrome | undefined {
        return this._editor ? chromeOf(this._editor) : undefined;
    }

    /** Light DOM children marked with `slot` are the host's; they move into the frame. */
    private _collectSlots(): void {
        for (const child of [...this.children]) {
            const slot = child.getAttribute('slot') as Slot | null;

            if (slot && SLOTS.includes(slot) && !this._slotted[slot].includes(child)) this._slotted[slot].push(child);
        }
    }

    private _buildFrame(): void {
        const chrome = this._chrome();

        if (!chrome) return;

        const head = element('div', 'verbb-editor__head');
        const above = element('div', 'verbb-editor__above');
        const extra = element('div', 'verbb-editor__extra');
        const actions = element('div', 'verbb-editor__actions');

        this._meta = element('div', 'verbb-editor__meta');
        this._status = element('span', 'verbb-editor__status');
        this._count = element('span', 'verbb-editor__count');
        this._meta.append(this._status, this._count);
        this._regions = { header: head, above, actions, footer: extra };

        for (const slot of SLOTS) this._regions[slot]!.append(...this._slotted[slot]);

        this._reply = element('div', 'verbb-editor__reply');
        head.prepend(this._reply);
        chrome.root.classList.add('verbb-editor--framed');

        // The text, with its tray, notice and a top toolbar, in one box. It's outlined when there's
        // something above or below it in the frame, so the toolbar reads as the text's own.
        this._box = element('div', 'verbb-editor__box');
        const inBox: Element[] = [];

        for (const child of [...chrome.root.children]) {
            if (child === chrome.foot) break;
            inBox.push(child);
        }

        chrome.foot.before(this._box);
        this._box.append(...inBox);
        this._box.before(above);
        chrome.root.prepend(head);
        chrome.foot.before(extra);
        chrome.foot.append(this._meta, actions);

        chrome.root.addEventListener('focusin', () => {
            this._open = true;
            clearTimeout(this._collapseTimer);
            chrome.root.classList.remove('is-collapsed');
        });
        // The frame collapses when focus moves to something else on the page. Focus that goes nowhere,
        // as when someone presses a field's instructions, switches window, or a password manager opens
        // its menu over a field, leaves it open, and a press outside the frame collapses it then.
        const checkSoon = () => {
            clearTimeout(this._collapseTimer);
            this._collapseTimer = setTimeout(() => {
                this._open = chrome.root.contains(document.activeElement);
                this._renderState();
            }, 140);
        };

        chrome.root.addEventListener('focusout', (event) => {
            const next = event.relatedTarget;

            if (!(next instanceof Element) || next instanceof HTMLIFrameElement || chrome.root.contains(next)) return;

            checkSoon();
        });

        if (this._outsidePress) document.removeEventListener('pointerdown', this._outsidePress);
        this._outsidePress = (event: PointerEvent) => {
            if (!chrome.root.classList.contains('is-collapsed') && !event.composedPath().includes(chrome.root)) checkSoon();
        };
        document.addEventListener('pointerdown', this._outsidePress);

        // Hosts may add slotted content after the editor has drawn itself.
        this._observer = new MutationObserver((records) => {
            for (const record of records) {
                record.addedNodes.forEach((node) => {
                    const slot = node instanceof Element ? node.getAttribute('slot') as Slot | null : null;

                    if (slot && SLOTS.includes(slot) && node.parentNode === this) {
                        const region = this._regions[slot];

                        this._slotted[slot].push(node);

                        // The host's actions come before the Post button, whenever they arrive.
                        if (slot === 'actions' && this._submit && this._submit.parentNode === region) region.insertBefore(node, this._submit);
                        else region?.append(node);

                        this._renderState();
                    }
                });
            }
        });
        this._observer.observe(this, { childList: true });

        this._renderReply();
        this._renderSubmit();
        this._renderState();
    }

    /**
     * "Replying to Alex", with a button to reply to the post instead. Cancelling fires a cancelable
     * `editor-reply-cancel` so the host can clear whatever links the reply to its parent.
     */
    private _renderReply(): void {
        const reply = this._reply;

        if (!reply) return;

        const name = this.getAttribute('reply-to')?.trim() ?? '';

        reply.replaceChildren();
        reply.hidden = !name;

        if (!name) return;

        const labels = this._labelSet();
        const text = element('span', 'verbb-editor__reply-text');
        // Split around `{name}` so a translation can put the name anywhere, still in bold.
        const [before, ...rest] = labels.replyingTo.split('{name}');

        text.append(before ?? '', element('b', undefined, name), rest.join('{name}'));

        const cancel = iconButton('close', labels.cancelReply);

        cancel.addEventListener('click', () => {
            const proceed = this.dispatchEvent(new CustomEvent('editor-reply-cancel', { detail: { name }, bubbles: true, cancelable: true }));

            if (!proceed) return;

            this.removeAttribute('reply-to');
            this._editor?.focus();
        });

        reply.append(icon('reply'), text, cancel);
    }

    private _renderSubmit(): void {
        const actions = this._regions.actions;

        if (!actions) return;

        const label = this.getAttribute('submit-label');

        if (!label) {
            this._submit?.remove();
            this._submit = null;

            return;
        }

        const labels = this._labelSet();
        const enter = this.hasAttribute('enter-submits');
        let button = this._submit;

        // One button for the element's life, redrawn in place, so keyboard focus stays on it while the host posts.
        if (!button) {
            button = element('button', 'verbb-editor__submit');
            button.type = 'button';
            button.addEventListener('click', () => this.requestSubmit());
            actions.append(button);
            this._submit = button;
        }

        button.replaceChildren();

        if (this._isBusy()) {
            const spinner = element('span', 'verbb-editor__spinner');

            spinner.setAttribute('aria-hidden', 'true');
            button.append(spinner, element('span', 'verbb-editor__submit-label', labels.posting));
            button.setAttribute('aria-label', labels.posting);
            button.setAttribute('aria-disabled', 'true');
            button.removeAttribute('aria-description');
            button.dataset.tip = labels.posting;
            delete button.dataset.keys;
        } else {
            button.append(element('span', 'verbb-editor__submit-label', label), element('kbd', undefined, enter ? '↵' : displayShortcut('Mod-Enter')), icon('send'));
            button.setAttribute('aria-label', label);
            button.dataset.keys = enter ? '↵' : displayShortcut('Mod-Enter');
        }
    }

    private _over(): number {
        const limit = Number(this.getAttribute('limit'));
        const chrome = this._chrome();

        return limit > 0 && chrome ? chrome.textLength() - limit : 0;
    }

    private _blocker(): string {
        const labels = this._labelSet();
        const editor = this._editor;

        if (!editor) return '';
        // A GIF can be posted on its own.
        if (editor.isEmpty() && !editor.getGif()) return labels.writeFirst;

        const over = this._over();

        if (over > 0) return formatLabel(labels.tooLong, { count: over });
        if (editor.isUploading()) return labels.uploadPending;
        if (this._chrome()?.hasFailedUploads()) return labels.uploadsFailed;

        return '';
    }

    private _announce(message: string): void {
        this._chrome()?.announce(message);
    }

    /** Draws everything that depends on the document: the counter, status, Post button and frame state. */
    /**
     * A bottom toolbar shares the footer's row with Post, until the host's fields come between the
     * text and Post. Then it moves into the text's box, so it stays with what it formats.
     */
    private _placeToolbar(chrome: EditorChrome): void {
        const above = this._regions.above;
        const extra = this._regions.footer;
        const fields = Boolean((above && !above.hidden) || (extra && !extra.hidden));

        chrome.root.classList.toggle('has-fields', fields);

        if (!chrome.toolbar || chrome.toolbarPosition !== 'bottom' || !this._box) return;

        if (extra && !extra.hidden) {
            if (chrome.toolbar.parentNode !== chrome.tools) chrome.tools.append(chrome.toolbar);
            if (chrome.tools.parentNode !== this._box) this._box.append(chrome.tools);
        } else if (chrome.toolbar.parentNode !== chrome.foot) {
            chrome.foot.prepend(chrome.toolbar);
            chrome.tools.remove();
        }
    }

    /**
     * Whether someone has changed a field the host put around the text, which collapsing would hide. A
     * value the page filled in, such as a returning guest's name, doesn't count.
     */
    private _slotsHaveValues(): boolean {
        return SLOTS.some((slot) => [...(this._regions[slot]?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea') ?? [])].some(changedControl));
    }

    private _renderState(): void {
        const chrome = this._chrome();
        const editor = this._editor;

        if (!chrome || !editor || !this._count || !this._status) return;

        const labels = this._labelSet();
        const root = chrome.root;
        const focused = this._open || root.contains(document.activeElement);

        root.classList.toggle('is-bare', this.hasAttribute('bare'));
        root.classList.toggle('is-busy', this._isBusy());
        root.classList.toggle('is-collapsed', this.hasAttribute('collapsible') && !focused && editor.isEmpty() && !editor.getGif() && !chrome.popovers.kind && !this._slotsHaveValues());

        for (const slot of SLOTS) {
            const region = this._regions[slot];

            // The header also holds the reply chip, which is hidden when there's no reply.
            if (region) region.hidden = ![...region.childNodes].some((node) => !(node instanceof HTMLElement && node.hidden));
        }

        this._placeToolbar(chrome);

        this._renderCount(labels);

        // Status, most important first: too long, then uploading, then a quiet draft note.
        const over = this._over();

        // Over the limit the text is invalid now, not only once someone tries to post it.
        if (over > 0) editor.tiptap.view.dom.setAttribute('aria-invalid', 'true');

        this._status.replaceChildren();
        this._status.className = 'verbb-editor__status';

        if (over > 0) {
            this._status.classList.add('is-bad');
            this._status.append(icon('alert'), element('span', 'verbb-editor__status-text', formatLabel(labels.tooLong, { count: over })));
        } else if (editor.isUploading()) {
            const spinner = element('span', 'verbb-editor__spinner');

            spinner.setAttribute('aria-hidden', 'true');
            this._status.append(spinner, element('span', 'verbb-editor__status-text', labels.uploadingStatus));
        } else if (this._draftState) {
            if (this._draftState === 'faded') this._status.classList.add('is-faded');

            this._status.append(icon('check'), element('span', 'verbb-editor__status-text', labels.draftSaved));
        }

        if (this._submit && !this._isBusy()) {
            const reason = this._blocker();
            const label = this.getAttribute('submit-label') ?? labels.submit;

            this._submit.setAttribute('aria-disabled', String(!!reason));
            this._submit.dataset.tip = reason || label;

            if (reason) this._submit.setAttribute('aria-description', reason);
            else this._submit.removeAttribute('aria-description');
        }
    }

    /** A ring appears at 80% of the limit and counts down the last stretch, then how far over. */
    private _renderCount(labels: ReturnType<VerbbEditorElement['_labelSet']>): void {
        const count = this._count!;
        const limit = Number(this.getAttribute('limit'));
        const length = this._chrome()?.textLength() ?? 0;

        count.replaceChildren();
        count.className = 'verbb-editor__count';
        delete count.dataset.tip;

        const left = limit - length;
        const state = !(limit > 0) || length < limit * 0.8 ? null : left < 0 ? 'over' : left <= limit * 0.1 ? 'warn' : 'ok';

        this._announceLimit(state === null ? 'ok' : state, left, labels);

        if (state === null) return;

        const radius = 8;
        const circumference = 2 * Math.PI * radius;
        const fraction = Math.min(length / limit, 1);
        const template = document.createElement('template');

        template.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle class="verbb-editor__ring-bg" cx="10" cy="10" r="${radius}"/><circle class="verbb-editor__ring-fg" cx="10" cy="10" r="${radius}" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - fraction)}"/></svg>`;
        count.classList.toggle('is-bad', left < 0);
        count.classList.toggle('is-warn', left >= 0 && left <= limit * 0.1);
        count.dataset.tip = formatLabel(labels.charactersOf, { count: length.toLocaleString(), limit: limit.toLocaleString() });
        count.append(template.content.firstElementChild!, element('span', undefined, String(left)));
        count.append(element('span', 'verbb-editor__sr', left < 0 ? formatLabel(labels.tooLong, { count: -left }) : formatLabel(labels.charactersLeft, { count: left })));
    }

    /**
     * The count isn't announced as it changes, which would interrupt every keystroke. Instead screen
     * readers hear once when the text reaches the last tenth of the limit, and once when it goes over.
     */
    private _announceLimit(state: 'ok' | 'warn' | 'over', left: number, labels: ReturnType<VerbbEditorElement['_labelSet']>): void {
        const previous = this._limitState;

        this._limitState = state;

        // Nothing on first draw: a restored draft or saved document isn't news.
        if (previous === null || previous === state) return;
        if (state === 'over') this._announce(formatLabel(labels.tooLong, { count: -left }));
        else if (state === 'warn' && previous === 'ok') this._announce(formatLabel(labels.charactersLeft, { count: left }));
    }

    /** Saves the document in this browser shortly after each change, and forgets it once it's back to where it started. */
    private _scheduleDraft(): void {
        const key = this.getAttribute('draft-key');
        const editor = this._editor;

        if (!key || !editor || this._isBusy()) return;

        clearTimeout(this._draftTimer);
        this._draftTimer = setTimeout(() => {
            const chrome = this._chrome();

            if (!this._editor || !chrome) return;

            const gif = this._editor.getGif();

            if (!this._editor.isDirty() || (this._editor.isEmpty() && !gif)) {
                writeDraft(key, null);

                if (this._draftState) {
                    this._draftState = null;
                    this._renderState();
                }

                return;
            }

            const previous = readDraft(key);
            const content = chrome.resolved();

            if (previous && JSON.stringify(previous.content) === JSON.stringify(normalizeContent(content)) && previous.gif?.url === gif?.url) return;

            writeDraft(key, { version: DRAFT_VERSION, savedAt: Date.now(), content, uploadTimes: chrome.uploadTimes(), gif });
            this._draftState = 'saved';
            this._renderState();
            clearTimeout(this._fadeTimer);
            this._fadeTimer = setTimeout(() => {
                this._draftState = 'faded';
                this._renderState();
            }, 2600);
        }, 800);
    }

    /** Brings back an unfinished draft, minus uploads Craft has already cleaned up, with a way out. */
    private _restoreDraft(): void {
        const key = this.getAttribute('draft-key');
        const editor = this._editor;
        const chrome = this._chrome();

        if (!key || !editor || !chrome || !editor.tiptap.isEditable) return;

        const draft = readDraft(key);

        if (!draft) return;

        const now = Date.now();
        let dropped = false;
        const content = draft.content.filter((node) => {
            if (node.type !== 'editorAsset' && node.type !== 'attachment') return true;

            const uploadedAt = draft.uploadTimes[Number((node.attrs as Record<string, unknown> | undefined)?.id)];
            const expired = typeof uploadedAt === 'number' && now - uploadedAt > UPLOAD_LIFETIME;

            dropped ||= expired;

            return !expired;
        });

        if (JSON.stringify(normalizeContent(content)) === JSON.stringify(chrome.resolved()) && draft.gif?.url === editor.getGif()?.url) return;

        const labels = this._labelSet();
        const message = formatLabel(labels.draftRestored, { time: relativeTime(draft.savedAt) }) + (dropped ? ` ${labels.draftFilesDropped}` : '');

        chrome.loadWithUploadTimes(content, draft.uploadTimes);
        if (draft.gif) editor.setGif(draft.gif);
        this._sync();
        this.dispatchEvent(new CustomEvent('editor-update', { detail: { editor, json: editor.getJSON(), html: editor.getHTML(), text: editor.getText(), gif: editor.getGif() }, bubbles: true }));
        chrome.notice.show('info', message, [{
            label: labels.discard,
            run: () => {
                this.clearDraft();
                editor.reset();
                editor.focus();
            },
        }], 'draft');
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'verbb-editor': VerbbEditorElement;
    }
}

let editorClassDefined = false;

export function registerVerbbEditorElement(tagName = 'verbb-editor'): void {
    if (customElements.get(tagName)) return;

    // A class can only be defined once, so any further tag name gets its own subclass.
    customElements.define(tagName, editorClassDefined ? class extends VerbbEditorElement {} : VerbbEditorElement);
    editorClassDefined = true;
}
