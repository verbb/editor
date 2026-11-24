import { DEFAULT_LABELS } from '../config/labels';
import { contentEquals, normalizeContent } from '../core/document';
import { Editor } from '../Editor';
import { featuresLoaded, loadFeatures } from '../features/load';
import { chromeOf } from '../internal';

import type { EditorContent, EditorGif, EditorLabels, EditorOptions } from '../types';

let labelledIdCounter = 0;

/** A promise with its resolve and reject, which remembers whether it has settled. */
function settleable<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });

    // A failure is reported through `editor-error` too, so an unwatched `ready` isn't an unhandled rejection.
    promise.catch(() => undefined);

    const state = {
        promise,
        settled: false,
        resolve: (value: T) => {
            state.settled = true;
            resolve(value);
        },
        reject: (reason: unknown) => {
            state.settled = true;
            reject(reason);
        },
    };

    return state;
}

function parseOptions(value: string | null): EditorOptions {
    if (!value) return {};

    try {
        const parsed: unknown = JSON.parse(value);

        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as EditorOptions : {};
    } catch {
        console.error('Editor couldn’t read `data-options`: it must be a JSON object, such as `{{ options|json_encode }}`.');

        return {};
    }
}

// A server render imports the package where there's no DOM. The element classes are never used
// there, but defining them mustn't fail.
const ElementBase = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * The editor input, the bare text box with its toolbar, uploads tray and form participation, for
 * sites that build their own frame. `<verbb-editor>` wraps it in the editor's full frame.
 */
export class VerbbEditorInputElement extends ElementBase {
    static formAssociated = true;

    static get observedAttributes(): string[] {
        return ['theme', 'preset', 'placeholder', 'name', 'gif-name', 'form', 'disabled', 'readonly', 'required', 'aria-label', 'aria-labelledby'];
    }

    /**
     * Loads the features these options use, so an element created afterwards mounts at once. Hosts
     * that know an element's options before adding it can call this first.
     */
    static loadFeatures(options: EditorOptions = {}): Promise<void> {
        return loadFeatures(options);
    }

    protected _editor: Editor | null = null;
    /** Bumped by every dispose, so a feature load that finishes afterwards doesn't mount a stale editor. */
    private _generation = 0;
    private _ready = settleable<Editor>();
    private _options: EditorOptions = {};
    private _content: EditorContent | undefined;
    private _gif: EditorGif | null | undefined;
    private _gifInput: HTMLInputElement | undefined;
    private _initial: EditorOptions['content'];
    private _internals: ElementInternals | undefined;
    private _input: HTMLInputElement | undefined;
    private _form: HTMLFormElement | null = null;
    private _formDisabled = false;
    private _labels: HTMLElement[] = [];

    private readonly _reset = () => this.formResetCallback();
    private readonly _focusFromLabel = (event: Event) => {
        if (event.target instanceof HTMLElement && !event.target.closest('a, button, input, select, textarea')) this.focus();
    };

    constructor() {
        super();

        const internals = this.attachInternals?.();

        if (internals && typeof internals.setFormValue === 'function') this._internals = internals;

        this.addEventListener('invalid', () => this._editor?.tiptap.view.dom.setAttribute('aria-invalid', 'true'));
    }

    connectedCallback(): void {
        // A property set before this class was defined shadows its accessor, which matters because
        // the bundle is a deferred module and pages may touch the element first.
        for (const property of ['options', 'value'] as const) {
            if (Object.prototype.hasOwnProperty.call(this, property)) {
                const value = (this as unknown as Record<string, unknown>)[property];

                delete (this as unknown as Record<string, unknown>)[property];
                (this as unknown as Record<string, unknown>)[property] = value;
            }
        }

        this._mount();
    }

    disconnectedCallback(): void {
        this._dispose();
    }

    attributeChangedCallback(name: string): void {
        if (!this.isConnected || !this._editor) return;

        switch (name) {
            case 'theme':
                this._editor.setTheme(this.options.theme ?? 'light');

                return;
            case 'placeholder':
                this._editor.setPlaceholder(this.options.placeholder ?? null);

                return;
            case 'aria-label':
            case 'aria-labelledby':
                this._syncAccessibleName();

                return;
            case 'preset':
                // Only the preset changes the schema, so only it needs a new editor.
                this._dispose();
                this._mount();

                return;
            default:
                this._sync();
        }
    }

    get editor(): Editor | null {
        return this._editor;
    }

    /**
     * Resolves with the editor once it's mounted. The Composer bundle loads links, mentions and
     * uploads on demand, so `editor` can be null for a moment after the element connects. Rejects if
     * a feature can't be loaded.
     */
    get ready(): Promise<Editor> {
        return this._editor ? Promise.resolve(this._editor) : this._ready.promise;
    }

    get json(): EditorContent {
        return this._editor?.getJSON() ?? this._content ?? normalizeContent(this._initial ?? []);
    }

    /**
     * The serialized document, or an empty string when there is none. Never `[]`, which the server
     * would read as the literal text "[]".
     */
    get value(): string {
        const json = this.json;

        return json.length ? JSON.stringify(json) : '';
    }

    get form(): HTMLFormElement | null {
        return this._internals?.form ?? this._form;
    }

    get labels(): NodeListOf<HTMLLabelElement> | HTMLLabelElement[] {
        return this._internals?.labels as NodeListOf<HTMLLabelElement> | undefined ?? [];
    }

    get validity(): ValidityState | undefined {
        return this._internals?.validity;
    }

    get validationMessage(): string {
        return this._internals?.validationMessage ?? '';
    }

    set value(value: string) {
        if (this._editor) {
            this._editor.setContent(value);
        } else {
            // Set before mounting, this is the document the form starts from and resets to.
            this._initial = value;
            this._content = undefined;
            this._gif = undefined;
        }
    }

    set options(value: EditorOptions) {
        this._dispose();
        this._options = {
            ...this._options,
            ...value,
            features: { ...this._options.features, ...value.features },
            request: { ...this._options.request, ...value.request },
        };

        if (value.content !== undefined) {
            this._content = undefined;
            this._initial = value.content;
        }

        if (value.gif !== undefined) this._gif = undefined;

        if (this.isConnected) this._mount();
    }

    /**
     * Options from the `data-options` attribute, then the `options` property, then the attributes,
     * which are the most specific choice for one instance.
     */
    get options(): EditorOptions {
        const attributes: EditorOptions = {};
        const theme = this.getAttribute('theme');
        const preset = this.getAttribute('preset');
        const placeholder = this.getAttribute('placeholder');

        if (theme) attributes.theme = theme as EditorOptions['theme'];
        if (preset) attributes.preset = preset as EditorOptions['preset'];
        if (placeholder !== null) attributes.placeholder = placeholder;

        const fromAttribute = parseOptions(this.getAttribute('data-options'));

        return {
            ...fromAttribute,
            ...this._options,
            features: { ...fromAttribute.features, ...this._options.features },
            labels: { ...fromAttribute.labels, ...this._options.labels },
            // `data-options` can only hold JSON, so a headers function always comes from the property.
            request: { ...fromAttribute.request, ...this._options.request },
            ...attributes,
        };
    }

    override focus(): void {
        this._editor?.focus();
    }

    formDisabledCallback(disabled: boolean): void {
        this._formDisabled = disabled;
        this._sync();
    }

    formResetCallback(): void {
        this._editor?.reset(this._initial ?? [], this.options.gif ?? null);
        this._sync();
    }

    formStateRestoreCallback(state: string | File | FormData | null): void {
        if (typeof state === 'string') this.value = state;
    }

    checkValidity(): boolean {
        return this._internals?.checkValidity() ?? true;
    }

    reportValidity(): boolean {
        return this._internals?.reportValidity() ?? true;
    }

    /** The interface strings this instance uses. */
    protected _labelSet(): EditorLabels {
        return { ...DEFAULT_LABELS, ...this.options.labels };
    }

    /** Extra editor options a subclass adds, such as `<verbb-editor>`'s keyboard shortcuts. */
    protected _editorOptions(): Record<string, unknown> {
        return {};
    }

    /** A reason to refuse submission beyond required and uploads, such as being over a limit. */
    protected _customValidity(): string {
        return '';
    }

    /** Whether editing is paused, for example while the host posts. */
    /**
     * The document, and with a `gif-name` the chosen GIF as JSON under that name too, so a form posts
     * both. Without a GIF, only the document goes.
     */
    private _formValue(): string | FormData {
        const gifName = this.getAttribute('gif-name');
        const gif = this._editor?.getGif();
        const name = this.getAttribute('name');

        if (!gifName || !gif || !name) return this.value;

        const data = new FormData();

        data.append(name, this.value);
        data.append(gifName, JSON.stringify(gif));

        return data;
    }

    protected _isBusy(): boolean {
        return false;
    }

    /** Called after every sync, so a subclass can redraw what depends on the document. */
    protected _afterSync(): void {}

    protected _dispose(): void {
        this._generation++;

        if (this._editor) {
            this._content = this._editor.getJSON();
            this._gif = this._editor.getGif();
        }
        if (this._ready.settled) this._ready = settleable<Editor>();

        this._editor?.destroy();
        this._editor = null;
        this._form?.removeEventListener('reset', this._reset);
        this._form = null;
        this._labels.forEach((label) => label.removeEventListener('click', this._focusFromLabel));
        this._labels = [];
    }

    protected _mount(): void {
        if (this._editor) return;

        const options = this.options;

        if (!featuresLoaded(options)) {
            this._mountWhenLoaded(options);

            return;
        }

        this.removeAttribute('aria-busy');

        this._initial ??= options.content ?? [];

        const mount = document.createElement('div');
        this.replaceChildren(mount);

        this._editor = new Editor(mount, {
            ...options,
            ...this._accessibleName(),
            ...this._editorOptions(),
            content: this._initial,
            onUpdate: (event) => {
                this._sync();
                options.onUpdate?.(event);
                this.dispatchEvent(new CustomEvent('editor-update', { detail: event, bubbles: true }));
            },
            onChange: (event) => {
                options.onChange?.(event);
                this.dispatchEvent(new CustomEvent('editor-change', { detail: event, bubbles: true }));
            },
            onUploadState: (event) => {
                this._sync();
                options.onUploadState?.(event);
                this.dispatchEvent(new CustomEvent('editor-upload-state', { detail: event, bubbles: true }));
            },
        } as EditorOptions);

        // Edits made before a disconnect or remount come back quietly; nothing has changed.
        const gifChanged = this._gif !== undefined && this._gif?.url !== this._editor.getGif()?.url;

        if ((this._content !== undefined && !contentEquals(this._content, this._editor.getJSON())) || gifChanged) {
            this._editor.restoreContent(this._content ?? this._editor.getJSON(), gifChanged ? this._gif : undefined);
        }

        // Native form association supports external forms and disabled fieldsets. The hidden
        // input keeps serialization/reset usable in browsers without ElementInternals.
        if (!this._internals) {
            this._input = document.createElement('input');
            this._input.type = 'hidden';
            this._gifInput = document.createElement('input');
            this._gifInput.type = 'hidden';
            this.append(this._input, this._gifInput);

            const target = this.getAttribute('form');

            this._form = target ? document.getElementById(target) as HTMLFormElement | null : this.closest('form');
            this._form?.addEventListener('reset', this._reset);
        }

        this._syncLabels();
        this._sync();
        this._ready.resolve(this._editor);
        this.dispatchEvent(new CustomEvent('editor-ready', { detail: { editor: this._editor }, bubbles: true }));
    }

    /** Whether the features this element's options use are loaded, so it can mount straight away. */
    protected _featuresLoaded(): boolean {
        return featuresLoaded(this.options);
    }

    private _mountWhenLoaded(options: EditorOptions): void {
        const generation = this._generation;

        this.setAttribute('aria-busy', 'true');

        loadFeatures(options).then(() => {
            if (generation === this._generation && this.isConnected) this._mount();
        }, (error: unknown) => {
            if (generation !== this._generation) return;

            // Never mount without a feature the options ask for: the editor would drop that content.
            this.removeAttribute('aria-busy');
            console.error(error);
            this._ready.reject(error);
            this.dispatchEvent(new CustomEvent('editor-error', { detail: { error }, bubbles: true }));
        });
    }

    /** A `<label>` names the field by reference, because the host isn't the focusable textbox. */
    private _accessibleName(): { ariaLabel?: string; ariaLabelledBy?: string } {
        const ariaLabelledBy = this.getAttribute('aria-labelledby') ?? undefined;
        const ariaLabel = this.getAttribute('aria-label') ?? this._options.ariaLabel;

        if (ariaLabelledBy || ariaLabel) return { ariaLabelledBy, ariaLabel };
        if (this._options.ariaLabelledBy) return { ariaLabelledBy: this._options.ariaLabelledBy };

        const labels = [...(this._internals?.labels ?? [])] as HTMLElement[];

        if (!labels.length) return {};

        return {
            ariaLabelledBy: labels.map((label) => {
                label.id ||= `verbb-editor-label-${++labelledIdCounter}`;

                return label.id;
            }).join(' '),
        };
    }

    private _syncAccessibleName(): void {
        this._editor?.setAccessibleName(this._accessibleName());
    }

    private _syncLabels(): void {
        this._labels = [...(this._internals?.labels ?? [])] as HTMLElement[];
        this._labels.forEach((label) => label.addEventListener('click', this._focusFromLabel));
    }

    protected _sync(): void {
        if (!this._editor) return;

        const disabled = this._formDisabled || this.hasAttribute('disabled');
        const readonly = this.hasAttribute('readonly') || this.options.editable === false || this._isBusy();
        const required = this.hasAttribute('required');
        const textbox = this._editor.tiptap.view.dom;

        this._editor.setEditable(!disabled && !readonly);

        if (required) textbox.setAttribute('aria-required', 'true');
        else textbox.removeAttribute('aria-required');

        if (this._internals) {
            const labels = this._labelSet();
            const active = !disabled && !readonly;
            const missing = active && required && this._editor.isEmpty() && !this._editor.getGif();
            const uploading = active && this._editor.isUploading();
            const failed = active && !!chromeOf(this._editor)?.hasFailedUploads();
            const custom = active ? this._customValidity() : '';

            this._internals.setFormValue(disabled ? null : this._formValue());

            if (uploading || failed || custom) {
                // Submitting now would post the document without the file that's on its way.
                this._internals.setValidity({ customError: true }, uploading ? labels.uploadPending : failed ? labels.uploadsFailed : custom, textbox);
            } else {
                this._internals.setValidity(missing ? { valueMissing: true } : {}, missing ? labels.required : '', textbox);
            }

            if (!missing && !uploading && !failed && !custom) textbox.removeAttribute('aria-invalid');
        }

        if (this._input) {
            this._input.name = this.getAttribute('name') ?? '';
            this._input.value = this.value;
            this._input.disabled = disabled;

            const form = this.getAttribute('form');

            if (form) this._input.setAttribute('form', form);
        }

        if (this._gifInput) {
            const gif = this._editor.getGif();

            this._gifInput.name = this.getAttribute('gif-name') ?? '';
            this._gifInput.value = gif ? JSON.stringify(gif) : '';
            this._gifInput.disabled = disabled || !gif || !this._gifInput.name;

            const form = this.getAttribute('form');

            if (form) this._gifInput.setAttribute('form', form);
        }

        this._afterSync();
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'verbb-editor-input': VerbbEditorInputElement;
    }
}

let inputClassDefined = false;

export function registerVerbbEditorInputElement(tagName = 'verbb-editor-input'): void {
    if (customElements.get(tagName)) return;

    // A class can only be defined once, so any further tag name gets its own subclass.
    customElements.define(tagName, inputClassDefined ? class extends VerbbEditorInputElement {} : VerbbEditorInputElement);
    inputClassDefined = true;
}
