import { Extension, type Editor as TiptapEditor } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';

import { formatLabel } from './config/labels';
import { normalizeGif, normalizeOptions } from './config/normalizeOptions';
import { getResolvedContent, createTiptapEditor } from './core/createEditor';
import { contentEquals, contentForSchema, contentIsEmpty, contentTextLength, contentToPlainText, normalizeContent, splitMedia, toDoc, withoutResolvedAttrs } from './core/document';
import { element, iconButton, place, Tooltip } from './ui/dom';
import { EditorView } from './ui/EditorView';
import { Bubble } from './ui/menus/Bubble';
import { Toolbar } from './ui/menus/Toolbar';
import { Notice } from './ui/Notice';
import { Popovers } from './ui/Popover';
import { feature, loadFeature, missingFeatures } from './features/registry';
import { loadFeatures } from './features/load';
import { setChrome, type EditorChrome } from './internal';

import type { GifChoice } from './gifs/giphy';
import type { GifPicker } from './gifs/picker';
import type { LinkTools } from './ui/menus/Link';
import type { Tray } from './ui/Tray';

import type {
    EditorContent,
    EditorGif,
    EditorOptions,
    EditorUpdateEvent,
    ResolvedEditorOptions,
} from './types';

import './styles/base.css';
import './styles/tokens.css';
import './styles/light.css';
import './styles/dark.css';
import './styles/craft.css';
import './styles/none.css';

let instanceCounter = 0;

/** Options `<verbb-editor>` passes in. They aren't part of the public options. */
interface InternalOptions {
    keymap?: Extension;
    helpRows?: () => [string, string][];
}

export class Editor {
    private readonly _id = `verbb-editor-${++instanceCounter}`;
    private readonly _host: HTMLElement;
    private readonly _options: ResolvedEditorOptions;
    private readonly _internal: InternalOptions;
    private _view: EditorView | null = null;
    private _popovers: Popovers | null = null;
    private _toolbar: Toolbar | null = null;
    private _tray: Tray | null = null;
    private _link: LinkTools | null = null;
    private _bubble: Bubble | null = null;
    private _tooltip: Tooltip | null = null;
    private _notice: Notice | null = null;
    private _tiptap: TiptapEditor | null = null;
    private _initialContent: EditorContent = [];
    private _gif: EditorGif | null = null;
    private _initialGif: EditorGif | null = null;
    /** GIPHY's ping for the chosen GIF, sent once the host has posted it. */
    private _gifSent: string | null = null;
    private _gifArea: HTMLElement | null = null;
    private _gifPicker: GifPicker | null = null;
    private _destroyed = false;
    private _dragDepth = 0;

    constructor(element: HTMLElement | string, options: EditorOptions = {}) {
        const host = typeof element === 'string'
            ? document.querySelector<HTMLElement>(element)
            : element;

        if (!host) {
            throw new Error(`Editor mount target not found: ${String(element)}`);
        }

        const { keymap, helpRows, ...publicOptions } = options as EditorOptions & InternalOptions;

        this._host = host;
        this._internal = { keymap, helpRows };
        this._options = normalizeOptions(publicOptions);

        const missing = missingFeatures(this._options);

        if (missing.length) {
            throw new Error(`Editor’s ${missing.join(', ')} feature${missing.length > 1 ? 's aren’t' : ' isn’t'} loaded. Create the editor with \`await Editor.create()\`, or call \`await loadFeatures(options)\` first.`);
        }

        this._mount();
        this._load(this._options.content);
        this._initialContent = this.getJSON();
        this._gif = this._options.gif;
        this._initialGif = this._gif;
        this._renderGif();
    }

    /**
     * Loads the features the options use, then builds the editor. The Composer bundle loads links,
     * mentions and uploads on demand, so this is how to create an editor from it.
     */
    static async create(element: HTMLElement | string, options: EditorOptions = {}): Promise<Editor> {
        await loadFeatures(options);

        return new Editor(element, options);
    }

    get tiptap(): TiptapEditor {
        if (!this._tiptap) {
            throw new Error('Editor has been destroyed.');
        }

        return this._tiptap;
    }

    get id(): string {
        return this._id;
    }

    /** The document to submit: references only, without values the server fills in for display. */
    getJSON(): EditorContent {
        return withoutResolvedAttrs(this._resolved());
    }

    /** An editing preview. Render persisted content through PHP for public output. */
    getHTML(): string {
        const media = this._tray?.nodes() ?? [];
        const text = this._tiptap?.getHTML() ?? '';

        if (!this._tiptap || !media.length) return text;

        // The uploads follow the text, as they do in the submitted document.
        const fragment = this._tiptap.schema.nodeFromJSON(toDoc(media)).content;
        const container = document.createElement('div');

        container.append(DOMSerializer.fromSchema(this._tiptap.schema).serializeFragment(fragment));

        return (this._tiptap.isEmpty ? '' : text) + container.innerHTML;
    }

    getText(): string {
        return this._tiptap ? contentToPlainText(this._resolved()) : '';
    }

    /**
     * How many characters of writing the document holds, the count `limit` uses. Image alt text and
     * attachment filenames don't count. The server's `RichText::getTextLength()` counts the same way.
     */
    getTextLength(): number {
        return this._tiptap ? contentTextLength(this._resolved()) : 0;
    }

    /** The GIF going with the document, chosen from GIPHY, or null. It's never part of `getJSON()`. */
    getGif(): EditorGif | null {
        return this._gif ? { ...this._gif } : null;
    }

    /** Sets or removes the GIF going with the document, as when loading a post to edit. */
    setGif(gif: EditorGif | null): void {
        this._setGif(normalizeGif(gif), null);
    }

    /**
     * Tells GIPHY the chosen GIF was sent, which its terms ask for. Call it once whatever the GIF went
     * with has been posted. A GIF set through `setGif()` wasn't chosen here, so there's nothing to send.
     */
    reportGifSent(): void {
        const sent = this._gifSent;

        this._gifSent = null;

        if (sent) void loadFeature('gifs').then((gifs) => new gifs.Giphy(this._options.gifs || { apiKey: '' }).ping(sent)).catch(() => undefined);
    }

    setContent(content: EditorContent | { type: 'doc'; content: EditorContent } | string): void {
        if (!this._tiptap) return;

        this._load(normalizeContent(content));
        this._emitUpdate();
    }

    clear(): void {
        this.setContent([]);
    }

    focus(): void {
        this._tiptap?.commands.focus();
    }

    blur(): void {
        this._tiptap?.commands.blur();
    }

    setEditable(editable: boolean): void {
        this._options.editable = editable;
        this._tiptap?.setEditable(editable, false);
        this._view?.root.classList.toggle('is-readonly', !editable);
        this._toolbar?.refresh();
        this._renderGif();
        this._bubble?.update();
    }

    /** Empty means no visible text and no atom, so a body holding only an image still counts. */
    isEmpty(): boolean {
        return this._tiptap ? contentIsEmpty(this._resolved()) : true;
    }

    isDirty(): boolean {
        return !contentEquals(this.getJSON(), this._initialContent) || this._gif?.url !== this._initialGif?.url;
    }

    /** Whether any upload is still in flight. Check this before submitting. */
    isUploading(): boolean {
        return this._tray?.isUploading() ?? false;
    }

    /**
     * Restores the initial document and GIF, or sets a new document and GIF as the clean baseline,
     * with no GIF unless one is given. Undo stops here too.
     */
    reset(content?: EditorOptions['content'], gif: EditorGif | null = null): void {
        if (!this._tiptap) return;

        this._load(content === undefined ? this._initialContent : normalizeContent(content));
        this._clearHistory();
        // Establish the schema-normalized baseline before reporting the reset event.
        this._initialContent = this.getJSON();
        this._gif = content === undefined ? this._initialGif : normalizeGif(gif);
        this._initialGif = this._gif;
        this._gifSent = null;
        this._renderGif();
        this._emitUpdate();
    }

    setTheme(theme: ResolvedEditorOptions['theme']): void {
        this._options.theme = theme;
        this._view?.setTheme(theme);
    }

    setPlaceholder(placeholder: string | null): void {
        this._options.placeholder = placeholder ?? '';

        const extension = this._tiptap?.extensionManager.extensions.find(({ name }) => name === 'placeholder');

        if (extension && this._tiptap) {
            extension.options.placeholder = this._options.placeholder;
            this._tiptap.view.dispatch(this._tiptap.state.tr);
        }
    }

    setAccessibleName(name: { ariaLabel?: string; ariaLabelledBy?: string }): void {
        this._options.ariaLabel = name.ariaLabel;
        this._options.ariaLabelledBy = name.ariaLabelledBy;

        if (this._tiptap) {
            const dom = this._tiptap.view.dom;

            dom.removeAttribute('aria-label');
            dom.removeAttribute('aria-labelledby');
            this._tiptap.view.dispatch(this._tiptap.state.tr);
        }
    }

    /**
     * Imports HTML through the schema. This is explicit because ordinary string content stays
     * literal. Pass `baseline` when the HTML is the saved document rather than a change to it.
     */
    importHTML(html: string, options: { baseline?: boolean } = {}): void {
        if (!this._tiptap) return;

        this._tray?.cancel();
        this._tiptap.chain().setMeta('addToHistory', false).setContent(html, { emitUpdate: false }).run();
        this._load(normalizeContent(this._tiptap.getJSON()));

        if (options.baseline) {
            this._clearHistory();
            this._initialContent = this.getJSON();
        }

        this._emitUpdate();
    }

    /** Puts content back after a remount without reporting a change, because nothing changed. */
    restoreContent(content: EditorContent, gif?: EditorGif | null): void {
        this._load(content);

        if (gif !== undefined) {
            this._gif = normalizeGif(gif);
            this._renderGif();
        }
    }

    destroy(): void {
        if (this._destroyed) {
            return;
        }

        this._destroyed = true;
        this._view?.destroy();
        this._popovers?.destroy();
        this._bubble?.hide();
        this._link?.destroy();
        this._toolbar?.destroy();
        this._tray?.destroy();
        this._gifPicker?.stop();
        this._gifPicker = null;
        this._tooltip?.destroy();
        this._tiptap?.destroy();
        this._tiptap = null;
        this._view = null;
        this._toolbar = null;
        this._tray = null;
        this._host.replaceChildren();
    }

    /** The document as the editor holds it: the text, then the uploads, with display values. */
    private _resolved(): EditorContent {
        if (!this._tiptap) return [];

        return [...getResolvedContent(this._tiptap), ...(this._tray?.nodes() ?? [])];
    }

    private _mount(): void {
        const view = new EditorView(this._host, this._options);
        const root = view.root;

        this._view = view;
        this._popovers = new Popovers(root, () => this._tiptap?.commands.focus());
        this._notice = new Notice(this._options.labels.dismiss);
        this._tooltip = new Tooltip(root);

        const shortcuts = Extension.create({
            name: 'verbbEditorShortcuts',
            addKeyboardShortcuts: () => ({
                'Mod-k': () => {
                    if (!this._link?.available()) return false;

                    this._link.open();

                    return true;
                },
            }),
        });

        this._tiptap = createTiptapEditor(view.contentElement, this._options, {
            onUpdate: () => {
                this._pullMedia();
                this._emitUpdate();
            },
        }, [shortcuts, ...(this._internal.keymap ? [this._internal.keymap] : [])]);

        const tiptap = this._tiptap;

        const { features } = this._options;

        this._tray = features.image || features.attachment ? new (feature('uploads').Tray)(root, this._options, this._popovers, () => tiptap.isEditable, {
            change: () => this._emitUpdate(),
            state: () => this._uploadState(),
            notice: (kind, text, source) => this._notice?.show(kind, text, [], source),
            clearNotice: () => this._notice?.clear('failed'),
            announce: (text) => view.announce(text),
        }) : null;
        this._link = features.link || features.craftLink ? new (feature('linkTools').LinkTools)(tiptap, this._options, root, this._popovers) : null;
        this._toolbar = new Toolbar(tiptap, this._options, root, this._popovers, {
            openLink: () => this._link?.open(),
            canLink: () => !!this._link?.available(),
            pickFiles: () => this._tray?.pick(),
            canAttach: () => !!this._tray?.canAttach(),
            photosOnly: () => !!this._tray?.photosOnly(),
            canMention: () => this._options.features.mention && !!this._options.craft && !!this._options.craft.endpoints?.mentions,
            openGifs: (trigger) => this._openGifs(trigger),
            canGif: () => !!this._options.gifs,
            helpRows: () => this._internal.helpRows?.() ?? [],
        });
        this._bubble = new Bubble(tiptap, root, this._options.labels.formatSelection, () => this._toolbar?.definitionsById ?? new Map(), () => !!this._popovers?.kind);

        // A chosen GIF shows under the text, ahead of any uploads.
        this._gifArea = this._options.gifs || this._options.gif ? element('div', 'verbb-editor__gif') : null;
        view.body.after(...(this._gifArea ? [this._gifArea] : []), ...(this._tray ? [this._tray.element] : []), this._notice.element);
        if (this._options.toolbar !== false) {
            if (this._options.toolbarPosition === 'top') {
                view.tools.append(this._toolbar.element);
                view.body.before(view.tools);
            } else {
                view.foot.append(this._toolbar.element);
            }
        }

        root.classList.toggle('verbb-editor--toolbar-top', this._options.toolbarPosition === 'top');

        const floating = () => {
            this._bubble?.update();
            this._link?.updateCard();
        };

        tiptap.on('transaction', () => this._toolbar?.refresh());
        tiptap.on('selectionUpdate', floating);
        tiptap.on('focus', floating);
        tiptap.on('blur', () => {
            // Wait for focus to land, so a press inside the bubble or link card doesn't close it first.
            setTimeout(() => {
                if (!this._tiptap?.isFocused) {
                    this._bubble?.hide();
                    this._link?.hideCard();
                }
            }, 0);
        });

        // ⌘K is the Link control's while the text has focus, so a page's own ⌘K, such as a site
        // search, doesn't open as well. ProseMirror's handler on the same element has already run.
        tiptap.view.dom.addEventListener('keydown', (event) => {
            if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && this._popovers?.kind === 'link') event.stopPropagation();
        });

        tiptap.view.dom.addEventListener('paste', (event) => {
            if (this._tray?.paste(event)) event.stopImmediatePropagation();
        }, true);

        this._watchDrops(root);
        this._toolbar.refresh();

        setChrome(this, {
            root,
            foot: view.foot,
            body: view.body,
            tools: view.tools,
            toolbar: this._options.toolbar === false ? null : this._toolbar.element,
            toolbarPosition: this._options.toolbarPosition,
            notice: this._notice,
            popovers: this._popovers,
            textLength: () => this.getTextLength(),
            hasFailedUploads: () => !!this._tray?.hasFailed(),
            pendingUploads: () => this._tray?.pendingCount() ?? 0,
            uploadTimes: () => this._tray?.uploadTimes() ?? {},
            loadWithUploadTimes: (content, times) => this._load(content, times),
            resolved: () => this._resolved(),
            hideFloating: () => {
                this._bubble?.hide();
                this._link?.hideCard();
                this._popovers?.close(false);
            },
            announce: (message) => view.announce(message),
        } satisfies EditorChrome);
    }

    /** The whole editor is the drop target, and a file it can't take never navigates the page away. */
    private _watchDrops(root: HTMLElement): void {
        const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes('Files');
        const canTake = () => !!this._tray?.canAttach() && !!this._tiptap?.isEditable;

        root.addEventListener('dragenter', (event) => {
            if (!hasFiles(event)) return;

            event.preventDefault();

            if (!canTake()) return;

            this._dragDepth++;
            root.classList.add('is-dropping');
        }, true);
        root.addEventListener('dragover', (event) => {
            if (hasFiles(event)) event.preventDefault();
        }, true);
        root.addEventListener('dragleave', () => {
            this._dragDepth = Math.max(0, this._dragDepth - 1);

            if (!this._dragDepth) root.classList.remove('is-dropping');
        }, true);
        root.addEventListener('drop', (event) => {
            const files = Array.from(event.dataTransfer?.files ?? []);

            if (!files.length) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            this._dragDepth = 0;
            root.classList.remove('is-dropping');

            if (this._tray) {
                this._tray.add(files);
            } else {
                // Without uploads there's no tray to say so, and its chunk isn't loaded for this.
                this._notice?.show('warn', files.map((file) => formatLabel(this._options.labels.unsupportedFile, { name: file.name })).join(' '), [], 'refused');
            }
        }, true);
    }

    /**
     * Loading a document is not an edit, so it never joins the undo history or reports an update.
     * Images and attachments go to the tray rather than the text.
     */
    private _load(content: EditorContent, uploadTimes: Record<number, number> = {}): void {
        if (!this._tiptap) return;

        const fitted = contentForSchema(content, this._tiptap.schema, this._options.features);
        const { text, media } = splitMedia(fitted);

        this._tiptap.chain().setMeta('addToHistory', false).setContent(text.length > 0 ? toDoc(text) : '', { emitUpdate: false }).run();
        this._tray?.load(media, uploadTimes);
    }

    /** Media pasted or dropped as HTML lands in the text; move it to the tray with the rest. */
    private _pullMedia(): void {
        const tiptap = this._tiptap;

        if (!tiptap) return;

        const found: { pos: number; size: number; json: Record<string, unknown> }[] = [];

        tiptap.state.doc.descendants((node, pos) => {
            if (node.type.name === 'editorAsset' || node.type.name === 'attachment') {
                found.push({ pos, size: node.nodeSize, json: node.toJSON() as Record<string, unknown> });

                return false;
            }

            return true;
        });

        if (!found.length) return;

        const tr = tiptap.state.tr.setMeta('addToHistory', false);

        [...found].reverse().forEach(({ pos, size }) => tr.delete(pos, pos + size));
        tiptap.view.dispatch(tr);
        this._tray?.append(found.map(({ json }) => json));
    }

    private _setGif(gif: EditorGif | null, sent: string | null): void {
        this._gif = gif;
        this._gifSent = sent;
        this._renderGif();
        this._emitUpdate();
    }

    /** The chosen GIF with a way to take it off, or nothing. */
    private _renderGif(): void {
        const area = this._gifArea;

        if (!area) return;

        area.replaceChildren();
        area.hidden = !this._gif;

        if (!this._gif) return;

        const { labels } = this._options;
        const frame = element('div', 'verbb-editor__gif-frame');
        const image = element('img', 'verbb-editor__gif-image');
        const remove = iconButton('close', labels.gifRemove, 'verbb-editor__remove');

        image.src = this._gif.url;
        image.alt = labels.gif;

        if (this._gif.width) image.width = this._gif.width;
        if (this._gif.height) image.height = this._gif.height;

        remove.disabled = !this._options.editable;
        remove.addEventListener('click', () => {
            this._setGif(null, null);
            this.focus();
        });
        frame.append(image, remove);
        area.append(frame);
    }

    /** GIF search in a popover above its control, loading its chunk the first time. */
    private _openGifs(trigger: HTMLElement): void {
        const config = this._options.gifs;
        const popovers = this._popovers;
        const root = this._view?.root;

        if (!config || !popovers || !root) return;

        if (popovers.kind === 'gifs') {
            popovers.close();

            return;
        }

        loadFeature('gifs').then((gifs) => {
            if (this._destroyed || !this._tiptap?.isEditable) return;

            const { labels } = this._options;

            this._gifPicker ??= new gifs.GifPicker({
                config,
                id: `${this._id}-gifs`,
                labels,
                onChoose: (choice: GifChoice) => {
                    popovers.close(false);
                    this._setGif(choice.gif, choice.sent);
                    this.focus();
                },
                onClose: () => popovers.close(),
            });

            const picker = this._gifPicker;
            const popover = popovers.open('gifs', 'verbb-editor__pop--gifs', { trigger, onClose: () => picker.stop() });

            popover.setAttribute('role', 'dialog');
            popover.setAttribute('aria-label', labels.gifSearch);
            popover.append(picker.element);
            place(popover, root, trigger.getBoundingClientRect(), 'above');
            picker.open();
        }, () => {
            this._notice?.show('warn', this._options.labels.gifUnavailable, [], 'gifs');
        });
    }

    private _clearHistory(): void {
        if (!this._tiptap) return;

        // ProseMirror's history has no clear command; rebuilding the state starts it afresh.
        const { doc, plugins } = this._tiptap.state;

        this._tiptap.view.updateState(EditorState.create({ doc, plugins }));
    }

    private _uploadState(): void {
        this._options.onUploadState?.({
            editor: this,
            uploading: this.isUploading(),
            pending: this._tray?.pendingCount() ?? 0,
        });
    }

    private _emitUpdate(): void {
        if (!this._tiptap) {
            return;
        }

        const payload: EditorUpdateEvent = {
            editor: this,
            json: this.getJSON(),
            html: this.getHTML(),
            text: this.getText(),
            gif: this.getGif(),
        };

        this._options.onUpdate?.(payload);
        this._options.onChange?.({
            ...payload,
            isDirty: this.isDirty(),
        });
    }
}
