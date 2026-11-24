import { formatLabel } from '../config/labels';
import { CraftClient } from '../craft/Client';
import { safeUrl } from '../core/urls';
import { element, iconButton, place, textButton } from './dom';
import { icon } from './icons';
import type { Popovers } from './Popover';

import type { EditorContent, ResolvedEditorOptions } from '../types';

export type UploadKind = 'inlineImage' | 'attachment';

export interface TrayItem {
    key: number;
    kind: UploadKind;
    /** The node's attributes as the editor shows them, including display-only values. */
    attrs: Record<string, unknown>;
    state: 'done' | 'uploading' | 'failed';
    progress: number;
    file?: File;
    preview?: string;
    controller?: AbortController;
    /** When this author uploaded it, so a restored draft can drop uploads Craft has cleaned up. */
    uploadedAt?: number;
}

export interface TrayCallbacks {
    /** The submitted document changed: an upload finished, alt text changed or an item went. */
    change: () => void;
    /** Upload state changed without changing the document. */
    state: () => void;
    /** `refused` is for files turned away before uploading; `failed` for uploads that didn't finish. */
    notice: (kind: 'warn' | 'bad', text: string, source: 'refused' | 'failed') => void;
    /** Nothing has failed any more, so a failure notice no longer applies. */
    clearNotice: () => void;
    /** Tells screen readers, without showing anything. */
    announce: (text: string) => void;
}

const NODE_TYPES: Record<UploadKind, string> = { inlineImage: 'editorAsset', attachment: 'attachment' };

function extensionOf(name: string): string {
    const dot = name.lastIndexOf('.');

    return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function formatSize(bytes: number): string {
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function hasPastedContent(event: ClipboardEvent): boolean {
    const html = event.clipboardData?.getData?.('text/html');

    if (!html) return false;

    return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').trim() !== '';
}

let keys = 0;

/**
 * Editor's own uploads: a tray under the text with progress, retry and alt text in place. Its items
 * are the document's image and attachment nodes, appended after the text when the document is read,
 * so references, counts and the server's association rules apply unchanged.
 */
export class Tray {
    readonly element = element('div', 'verbb-editor__tray');

    private items: TrayItem[] = [];
    private readonly client: CraftClient | null;
    private destroyed = false;
    private rendered = '';

    constructor(
        private readonly root: HTMLElement,
        private readonly options: ResolvedEditorOptions,
        private readonly popovers: Popovers,
        private readonly isEditable: () => boolean,
        private readonly callbacks: TrayCallbacks,
    ) {
        this.client = options.craft ? new CraftClient(options.craft, options.labels, options.request) : null;
        this.element.setAttribute('role', 'group');
        this.element.setAttribute('aria-label', options.labels.uploads);
        this.element.addEventListener('click', (event) => this.click(event));
    }

    /** Whether this editor can take files at all, which decides the drop target and the Attach control. */
    canAttach(): boolean {
        return !!this.client && (this.options.features.image || this.options.features.attachment);
    }

    photosOnly(): boolean {
        return this.options.features.image && !this.options.features.attachment;
    }

    isUploading(): boolean {
        return this.items.some((item) => item.state === 'uploading');
    }

    pendingCount(): number {
        return this.items.filter((item) => item.state === 'uploading').length;
    }

    hasFailed(): boolean {
        return this.items.some((item) => item.state === 'failed');
    }

    /** The finished uploads as document nodes, with display values still attached. */
    nodes(): EditorContent {
        return this.items.filter((item) => item.state === 'done').map((item) => ({ type: NODE_TYPES[item.kind], attrs: { ...item.attrs } }));
    }

    uploadTimes(): Record<number, number> {
        return Object.fromEntries(this.items.filter((item) => item.state === 'done' && item.uploadedAt).map((item) => [Number(item.attrs.id), item.uploadedAt as number]));
    }

    /** Replaces the tray with saved media. Loading is not an edit, so nothing is reported. */
    load(nodes: EditorContent, uploadTimes: Record<number, number> = {}): void {
        this.cancel(false);
        this.items = nodes.map((node) => ({
            key: ++keys,
            kind: node.type === 'attachment' ? 'attachment' : 'inlineImage',
            attrs: { ...(node.attrs as Record<string, unknown> ?? {}) },
            state: 'done',
            progress: 1,
            uploadedAt: uploadTimes[Number((node.attrs as Record<string, unknown> | undefined)?.id)],
        }));
        this.render();
    }

    /** Adds saved media after what's already here, such as media pasted into the text. */
    append(nodes: EditorContent): void {
        this.items.push(...nodes.map((node): TrayItem => ({
            key: ++keys,
            kind: node.type === 'attachment' ? 'attachment' : 'inlineImage',
            attrs: { ...(node.attrs as Record<string, unknown> ?? {}) },
            state: 'done',
            progress: 1,
        })));
        this.render();
    }

    /** Stops uploads in flight and empties the tray, as loading a different document does. */
    cancel(notify = true): void {
        const wasUploading = this.isUploading();

        this.items.forEach((item) => {
            item.controller?.abort();

            if (item.preview) URL.revokeObjectURL(item.preview);
        });
        this.items = [];
        this.render();

        if (notify && wasUploading) this.callbacks.state();
    }

    destroy(): void {
        this.destroyed = true;
        this.cancel(false);
    }

    pick(): void {
        if (!this.canAttach() || !this.isEditable()) return;

        const input = document.createElement('input');
        const extensions = [
            ...(this.options.features.image ? this.allowedExtensions('inlineImage') ?? [] : []),
            ...(this.options.features.attachment ? this.allowedExtensions('attachment') ?? [] : []),
        ];

        input.type = 'file';
        input.multiple = true;

        if (extensions.length) input.accept = extensions.map((extension) => `.${extension}`).join(',');
        else if (this.photosOnly()) input.accept = 'image/*';

        input.addEventListener('change', () => this.add(Array.from(input.files ?? [])), { once: true });
        input.click();
    }

    /** Files from a paste. Office apps put a picture of the selection beside its text, and the text is what was copied. */
    paste(event: ClipboardEvent): boolean {
        if (!this.isEditable() || !this.canAttach() || hasPastedContent(event)) return false;

        const files = Array.from(event.clipboardData?.files ?? []);

        if (!files.length) return false;

        event.preventDefault();
        this.add(files);

        return true;
    }

    /** Refuses here what the server would refuse anyway, so the author learns before waiting. */
    add(files: File[]): void {
        const { labels } = this.options;
        const refused: string[] = [];
        let capped = '';

        for (const file of files) {
            const kind = this.kindFor(file);
            const maxFileSize = this.options.craft ? this.options.craft.uploads?.maxFileSize : undefined;

            if (!this.client || !kind || !this.isEditable()) {
                refused.push(formatLabel(labels.unsupportedFile, { name: file.name }));
                continue;
            }

            if (maxFileSize && file.size > maxFileSize) {
                refused.push(formatLabel(labels.fileTooLarge, { name: file.name }));
                continue;
            }

            const max = this.options.craft ? (kind === 'inlineImage' ? this.options.craft.uploads?.maxImages : this.options.craft.uploads?.maxAttachments) : null;

            if (max && this.items.filter((item) => item.kind === kind).length >= max) {
                capped = formatLabel(kind === 'inlineImage' ? labels.tooManyImages : labels.tooManyFiles, { count: max });
                continue;
            }

            const item: TrayItem = {
                key: ++keys,
                kind,
                file,
                attrs: kind === 'inlineImage' ? { alt: '', title: file.name } : { filename: file.name, size: file.size, mimeType: file.type || null },
                state: 'uploading',
                progress: 0,
                preview: kind === 'inlineImage' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined,
            };

            this.items.push(item);
            void this.send(item);
        }

        const message = [...refused, capped].filter(Boolean).join(' ');

        if (message) this.callbacks.notice('warn', message, 'refused');

        this.render();
    }

    private allowedExtensions(kind: UploadKind): string[] | null {
        const uploads = this.options.craft ? this.options.craft.uploads : undefined;

        return (kind === 'inlineImage' ? uploads?.imageExtensions : uploads?.attachmentExtensions) ?? null;
    }

    private canTake(file: File, kind: UploadKind): boolean {
        if (kind === 'inlineImage' ? !this.options.features.image : !this.options.features.attachment) return false;

        const extensions = this.allowedExtensions(kind);

        return extensions ? extensions.includes(extensionOf(file.name)) : kind === 'inlineImage' ? file.type.startsWith('image/') : true;
    }

    private kindFor(file: File): UploadKind | null {
        if (file.type.startsWith('image/') && this.canTake(file, 'inlineImage')) return 'inlineImage';
        if (this.canTake(file, 'attachment')) return 'attachment';

        return this.canTake(file, 'inlineImage') ? 'inlineImage' : null;
    }

    private async send(item: TrayItem): Promise<void> {
        if (!this.client || !item.file || this.destroyed) return;

        const controller = new AbortController();

        item.controller?.abort();
        item.controller = controller;
        item.state = 'uploading';
        item.progress = 0;
        this.render();
        this.callbacks.state();

        try {
            const asset = await this.client.uploadAsset(item.file, item.kind, {
                signal: controller.signal,
                onProgress: (fraction) => {
                    item.progress = fraction;
                    this.render();
                },
            });

            if (controller.signal.aborted || this.destroyed) return;

            item.attrs = item.kind === 'inlineImage'
                ? { id: asset.id, src: asset.url, alt: item.attrs.alt ?? '', title: asset.filename }
                : { id: asset.id, url: asset.url, filename: asset.filename, mimeType: asset.mimeType ?? item.file.type ?? null, size: asset.size ?? item.file.size };
            item.state = 'done';
            item.progress = 1;
            item.uploadedAt = Date.now();
            item.controller = undefined;
            this.render();

            if (!this.hasFailed()) this.callbacks.clearNotice();

            // Only the finish is announced: the author started the upload, and progress would interrupt.
            this.callbacks.announce(formatLabel(this.options.labels.uploaded, { name: item.file.name }));
            this.callbacks.change();
            this.callbacks.state();
        } catch (error) {
            if (controller.signal.aborted || this.destroyed) return;

            item.state = 'failed';
            item.controller = undefined;
            this.render();
            this.callbacks.notice('bad', formatLabel(this.options.labels.uploadFailed, { name: item.file.name, reason: error instanceof Error ? error.message : '' }), 'failed');
            this.callbacks.state();
        }
    }

    private remove(item: TrayItem): void {
        const wasDone = item.state === 'done';
        const wasUploading = item.state === 'uploading';

        item.controller?.abort();

        if (item.preview) URL.revokeObjectURL(item.preview);

        this.items = this.items.filter((candidate) => candidate !== item);
        this.render();

        if (!this.hasFailed()) this.callbacks.clearNotice();

        if (wasDone) this.callbacks.change();
        if (wasUploading || !wasDone) this.callbacks.state();
    }

    private click(event: Event): void {
        const control = (event.target as HTMLElement).closest<HTMLElement>('[data-tray]');
        const item = this.items.find((candidate) => String(candidate.key) === control?.closest<HTMLElement>('[data-key]')?.dataset.key);

        if (!control || !item || !this.isEditable()) return;

        switch (control.dataset.tray) {
            case 'remove':
                this.remove(item);
                this.root.querySelector<HTMLElement>('.ProseMirror')?.focus();

                break;
            case 'retry':
                void this.send(item);

                break;
            case 'alt':
                this.editAlt(item, control);

                break;
        }
    }

    private nameOf(item: TrayItem): string {
        const { labels } = this.options;

        return String(item.file?.name ?? (item.kind === 'inlineImage' ? item.attrs.title || item.attrs.alt || labels.uploadedImage : item.attrs.filename || labels.attachment));
    }

    private editAlt(item: TrayItem, trigger: HTMLElement): void {
        const { labels } = this.options;
        const popover = this.popovers.open('alt', 'verbb-editor__pop--sm', { trigger });
        const body = element('div', 'verbb-editor__alt');
        const source = this.imageSource(item);
        const id = `verbb-editor-alt-${item.key}`;
        const label = element('label', 'verbb-editor__sr', labels.altText);
        const field = element('textarea');
        const hint = element('p', undefined, labels.altHint);
        const foot = element('div', 'verbb-editor__pop-foot');
        const cancel = textButton(labels.cancel);
        const save = textButton(labels.save, 'verbb-editor__button verbb-editor__button--primary');

        if (source) {
            const image = element('img');

            image.src = source;
            image.alt = '';
            body.append(image);
        }

        label.htmlFor = id;
        field.id = id;
        field.placeholder = labels.altPrompt;
        field.value = String(item.attrs.alt ?? '');
        body.append(label, field, hint);
        foot.append(element('span', 'verbb-editor__grow'), cancel, save);
        popover.append(body, foot);

        const commit = () => {
            item.attrs = { ...item.attrs, alt: field.value.trim() };
            this.popovers.close();
            this.rendered = '';
            this.render();
            this.callbacks.change();
        };

        cancel.addEventListener('click', () => this.popovers.close());
        save.addEventListener('click', commit);
        field.addEventListener('keydown', (event) => {
            // The tray sits inside the host's form, where Enter would otherwise submit it.
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                commit();
            }
        });

        place(popover, this.root, trigger.getBoundingClientRect(), 'above');
        field.focus();
    }

    private imageSource(item: TrayItem): string {
        return safeUrl(item.attrs.src, true) || item.preview || '';
    }

    private render(): void {
        const signature = JSON.stringify(this.items.map((item) => [item.key, item.state, Math.round(item.progress * 100), item.attrs.alt, item.attrs.id]));

        // Progress events arrive often; rebuild only when something visible changed.
        if (signature === this.rendered) return;

        this.rendered = signature;

        const focused = this.element.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
        const focusKey = focused?.closest<HTMLElement>('[data-key]')?.dataset.key;
        const focusAction = focused?.dataset.tray;

        this.element.replaceChildren(...this.items.map((item) => (item.kind === 'inlineImage' ? this.renderImage(item) : this.renderFile(item))));
        this.element.hidden = this.items.length === 0;

        if (focusKey) {
            const restore = this.element.querySelector<HTMLElement>(`[data-key="${focusKey}"] [data-tray="${focusAction}"]`)
                ?? this.element.querySelector<HTMLElement>(`[data-key="${focusKey}"] button`);

            restore?.focus();
        }
    }

    private renderImage(item: TrayItem): HTMLElement {
        const { labels } = this.options;
        const name = this.nameOf(item);
        const thumb = element('div', 'verbb-editor__thumb');
        const source = this.imageSource(item);

        thumb.dataset.key = String(item.key);

        if (source) {
            const image = element('img');

            image.src = source;
            image.alt = String(item.attrs.alt ?? '');
            thumb.append(image);
        } else {
            const placeholder = element('span', 'verbb-editor__thumb-empty');

            placeholder.append(icon('camera'));
            placeholder.title = name;
            thumb.append(placeholder);
        }

        if (item.state === 'uploading') {
            const veil = element('div', 'verbb-editor__veil');

            veil.append(this.ring(item.progress, 12), element('span', 'verbb-editor__sr', formatLabel(labels.uploadingFile, { name, percent: Math.round(item.progress * 100) })));
            thumb.append(veil);
        }

        if (item.state === 'failed') {
            const veil = element('div', 'verbb-editor__veil verbb-editor__veil--bad');
            const retry = iconButton('retry', formatLabel(labels.retryUpload, { name }), 'verbb-editor__veil-button');

            retry.dataset.tray = 'retry';
            veil.append(retry);
            thumb.append(veil);
        }

        if (item.state === 'done') {
            const alt = element('button', 'verbb-editor__alt-button');

            alt.type = 'button';
            alt.dataset.tray = 'alt';
            alt.setAttribute('aria-label', formatLabel(item.attrs.alt ? labels.editAlt : labels.addAlt, { name }));
            alt.dataset.tip = item.attrs.alt ? String(item.attrs.alt) : labels.altPrompt;

            if (item.attrs.alt) alt.append(icon('check'));

            alt.append(document.createTextNode('ALT'));
            thumb.append(alt);
        }

        thumb.append(this.removeButton(item, name));

        return thumb;
    }

    private renderFile(item: TrayItem): HTMLElement {
        const { labels } = this.options;
        const name = this.nameOf(item);
        const row = element('div', `verbb-editor__file${item.state === 'failed' ? ' is-failed' : ''}`);
        const glyph = element('span', 'verbb-editor__file-icon');
        const text = element('span', 'verbb-editor__file-text');
        const meta = element('span');

        row.dataset.key = String(item.key);
        glyph.append(icon('file'));
        text.append(element('b', undefined, name));

        if (item.state === 'uploading') {
            const bar = element('span', 'verbb-editor__bar');
            const fill = element('i');

            fill.style.width = `${Math.round(item.progress * 100)}%`;
            bar.append(fill);
            meta.append(bar, element('span', 'verbb-editor__sr', formatLabel(labels.uploadingFile, { name, percent: Math.round(item.progress * 100) })));
        } else if (item.state === 'failed') {
            const retry = element('button', 'verbb-editor__link-button', labels.retry);

            retry.type = 'button';
            retry.dataset.tray = 'retry';
            retry.setAttribute('aria-label', formatLabel(labels.retryUpload, { name }));
            meta.append(document.createTextNode(`${labels.uploadFailedShort} · `), retry);
        } else {
            const size = typeof item.attrs.size === 'number' ? formatSize(item.attrs.size) : '';

            // Each part is isolated, so "1 KB" stays whole in a right-to-left layout.
            [size, extensionOf(name).toUpperCase()].filter(Boolean).forEach((part, index) => {
                if (index) meta.append(' · ');

                meta.append(element('bdi', undefined, part));
            });
        }

        text.append(meta);
        row.append(glyph, text, this.removeButton(item, name));

        return row;
    }

    private removeButton(item: TrayItem, name: string): HTMLButtonElement {
        const button = iconButton('close', formatLabel(this.options.labels.remove, { name }), 'verbb-editor__remove');

        button.dataset.tray = 'remove';
        delete button.dataset.tip;

        return button;
    }

    private ring(fraction: number, radius: number): SVGSVGElement {
        const size = radius * 2 + 6;
        const circumference = 2 * Math.PI * radius;
        const template = document.createElement('template');

        template.innerHTML = `<svg class="verbb-editor__ring" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle class="verbb-editor__ring-bg" cx="${size / 2}" cy="${size / 2}" r="${radius}"/><circle class="verbb-editor__ring-fg" cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - fraction)}"/></svg>`;

        return template.content.firstElementChild as SVGSVGElement;
    }
}
