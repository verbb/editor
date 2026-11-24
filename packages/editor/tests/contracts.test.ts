import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, registerVerbbEditorElement, VerbbEditorElement } from '../src';
import { CraftClient } from '../src/craft/Client';
import { normalizeContent } from '../src/core/document';
import { Mark } from '@tiptap/core';
import { stubUploads } from './xhr';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function mount(options: ConstructorParameters<typeof Editor>[1] = {}) {
    const host = document.createElement('div'); document.body.append(host);
    const editor = new Editor(host, options); editors.push(editor); return { editor, host };
}
const text = (value: string) => [{ type: 'paragraph', content: [{ type: 'text', text: value }] }];
const response = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
const craft = {
    context: 'a',
    csrfToken: false as const,
    endpoints: { upload: '/upload', mentions: '/mentions', elements: '/elements' },
};

it('preserves literal legacy identifiers, attribute keys and Unicode while converting structural names', () => {
    const literal = 'bullet_list 👩‍💻 فارسی‌نویسی';
    const input = [{ type: 'bullet_list', attrs: { bullet_list: literal }, content: [{ type: 'list_item', content: text(literal) }] }];
    const value = normalizeContent(input);
    expect(value[0].type).toBe('bulletList');
    expect(value[0].attrs).toEqual({ bullet_list: literal });
    expect(JSON.stringify(value)).toContain(literal);
    expect(input[0].type).toBe('bullet_list');
    expect(normalizeContent('first\nsecond')[0].content).toEqual([{ type: 'text', text: 'first' }, { type: 'hardBreak' }, { type: 'text', text: 'second' }]);
});

it('starts empty/clean, emits once per set, and resets the canonical baseline', () => {
    const update = vi.fn(); const { editor } = mount({ onUpdate: update });
    expect(editor.isEmpty()).toBe(true); expect(editor.isDirty()).toBe(false);
    editor.setContent('hello'); expect(update).toHaveBeenCalledTimes(1); expect(editor.isDirty()).toBe(true);
    editor.reset(); expect(editor.isEmpty()).toBe(true); expect(editor.isDirty()).toBe(false);
    editor.reset('new initial'); expect(editor.isDirty()).toBe(false);
    editor.setContent('different'); editor.reset(); expect(editor.getText()).toBe('new initial');
    editor.setEditable(false); expect(update).toHaveBeenCalledTimes(5);
});

it('imports HTML explicitly and keeps ordinary string input literal', () => {
    const { editor } = mount();
    editor.setContent('<strong>literal</strong>'); expect(editor.getText()).toBe('<strong>literal</strong>');
    editor.importHTML('<p><strong>imported</strong><script>alert(1)</script></p>');
    expect(editor.getJSON()[0].content).toEqual([{ type: 'text', marks: [{ type: 'bold' }], text: 'imported' }]);
});

it.each([
    { link: true }, { craftLink: true }, { link: true, craftLink: true }, { link: false, craftLink: false },
])('supports independent link schemas %o', (features) => {
    const { editor } = mount({ features }); expect(editor.isEmpty()).toBe(true);
});

it('round-trips enabled formatting and identities through browser HTML', () => {
    const content = [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', marks: [{ type: 'underline' }], text: 'Title' }] },
        { type: 'paragraph', content: [
            { type: 'text', text: 'Entry', marks: [{ type: 'craftLink', attrs: { id: 7, type: 'entry', label: 'Entry', href: '/entry' } }] },
            { type: 'mention', attrs: { id: 4, type: 'user', label: 'Alice' } },
        ] },
        { type: 'editorAsset', attrs: { id: 9, src: '/image.png', alt: 'Description', title: 'Image' } },
        { type: 'attachment', attrs: { id: 10, url: '/file.pdf', filename: 'Paper', mimeType: 'application/pdf', size: 1234 } },
    ];
    const { editor } = mount({ content, preset: 'full', features: { craftLink: true, mention: true, image: true, attachment: true } });
    const json = editor.getJSON();
    expect(json[0]).toEqual(content[0]);
    expect(json[1].content).toEqual([
        { type: 'text', text: 'Entry', marks: [{ type: 'craftLink', attrs: { id: 7, type: 'entry', label: 'Entry' } }] },
        { type: 'mention', attrs: { id: 4, type: 'user', label: 'Alice' } },
    ]);
    expect(json[2].attrs).toEqual({ id: 9, alt: 'Description', title: 'Image' });
    expect(json[3].attrs).toEqual({ id: 10 });
    // Resolved values still render for display, and re-importing them changes nothing.
    expect(editor.getHTML()).toContain('href="/entry"');
    expect(editor.getHTML()).toContain('src="/image.png"');
    expect(editor.getHTML()).toContain('href="/file.pdf"');
    expect(editor.getText()).toContain('Paper');
    expect(editor.isDirty()).toBe(false);
    editor.importHTML(editor.getHTML());
    expect(editor.getJSON()).toEqual(json);
});

it('retains native custom extensions and excludes disabled built-ins', () => {
    const Custom = Mark.create({ name: 'highlight', parseHTML: () => [{ tag: 'mark' }], renderHTML: () => ['mark', 0] });
    const { editor, host } = mount({ preset: 'minimal', features: { bold: false }, extensions: [Custom] });
    editor.importHTML('<p><mark>Custom</mark><strong>Plain</strong></p>');
    expect(editor.getHTML()).toContain('<mark>Custom</mark>'); expect(editor.getHTML()).not.toContain('<strong>');
    expect(host.querySelector('[data-command="bold"]')).toBeNull();
});

it('preserves component edits and dirty state across theme, options and reconnection, then submits/reset forms', () => {
    registerVerbbEditorElement();
    const form = document.createElement('form');
    const component = document.createElement('verbb-editor') as VerbbEditorElement;
    component.setAttribute('name', 'body'); component.options = { content: 'Initial' };
    form.append(component); document.body.append(form);
    component.editor!.setContent('Changed'); component.setAttribute('theme', 'dark');
    component.options = { placeholder: 'Continue' };
    component.remove(); form.append(component);
    expect(component.editor!.getText()).toBe('Changed'); expect(component.editor!.isDirty()).toBe(true);
    expect(new FormData(form).get('body')).toBe(JSON.stringify(text('Changed')));
    form.reset(); expect(component.editor!.getText()).toBe('Initial'); expect(component.editor!.isDirty()).toBe(false);
    component.setAttribute('readonly', '');
    expect(component.editor!.tiptap.isEditable).toBe(false);
    expect([...component.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    component.setAttribute('disabled', ''); expect(new FormData(form).has('body')).toBe(false);
});

describe('Craft transport', () => {
    it('keeps context/CSRF/signal on scoped discovery and filters malformed results', async () => {
        const fetcher = vi.fn().mockResolvedValue(response({ results: [{ id: 1, type: 'user', label: 'Alice' }, { id: -1, label: 'Invalid' }] }));
        vi.stubGlobal('fetch', fetcher);
        const client = new CraftClient({ endpoints: { mentions: '/site/index.php?p=actions/verbb-editor/mentions/search' }, context: 'a', csrfTokenName: 'csrf', csrfToken: 'token', scope: { ownerId: 3 } });
        const controller = new AbortController();
        expect(await client.searchMentions('Al', { signal: controller.signal })).toEqual([{ id: 1, type: 'user', label: 'Alice' }]);
        expect(fetcher.mock.calls[0][0]).toBe('/site/index.php?p=actions/verbb-editor/mentions/search');
        const init = fetcher.mock.calls[0][1];
        expect(init.signal).toBe(controller.signal); expect(JSON.parse(init.body)).toEqual({ query: 'Al', scope: { ownerId: 3 }, context: 'a', csrf: 'token' });
        expect(init.headers['X-CSRF-Token']).toBe('token');
    });
    it.each([401, 403, 429, 500])('normalizes HTTP %s failures', async (status) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: async () => { throw new Error('raw HTML'); } }));
        await expect(new CraftClient(craft).searchElements('x')).rejects.not.toThrow('raw HTML');
    });
    it('normalizes network errors and preserves abort cancellation', async () => {
        const fetcher = vi.fn().mockRejectedValue(new TypeError('internal detail')); vi.stubGlobal('fetch', fetcher);
        await expect(new CraftClient(craft).searchMentions('x')).rejects.toThrow('Unable to connect');
        fetcher.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
        await expect(new CraftClient(craft).searchMentions('x')).rejects.toHaveProperty('name', 'AbortError');
    });
    it('rejects malformed or unsafe successful uploads', async () => {
        stubUploads(() => ({ status: 200, body: { asset: { id: 1, filename: 'x', kind: 'inlineImage', url: 'javascript:alert(1)' } } }));
        await expect(new CraftClient(craft).uploadAsset(new File(['x'], 'x.png'))).rejects.toThrow('Something went wrong');
    });
    it('reports upload progress and passes refusals through', async () => {
        const fractions: number[] = [];
        stubUploads((_body, request) => {
            request.progress(50, 100);
            return { status: 400, body: { message: 'File type is not permitted.' } };
        });
        await expect(new CraftClient(craft).uploadAsset(new File(['x'], 'x.png'), 'inlineImage', { onProgress: (fraction) => fractions.push(fraction) })).rejects.toThrow('File type is not permitted.');
        expect(fractions).toEqual([0.5]);
    });
});

it('uploads pasted images to the tray, retries a failure, and drops a pending upload after replacing content', async () => {
    let attempts = 0;
    let finish: () => void = () => {};
    const requests = stubUploads(() => {
        attempts++;
        if (attempts === 1) return 'error';
        if (attempts === 2) return { status: 200, body: { asset: { id: 42, filename: 'photo.png', kind: 'inlineImage', url: '/photo.png' } } };
        return new Promise((resolve) => { finish = () => resolve({ status: 200, body: { asset: { id: 99, filename: 'photo.png', kind: 'inlineImage', url: '/photo.png' } } }); });
    });
    const { editor, host } = mount({ craft, features: { image: true } });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [new File(['photo'], 'photo.png', { type: 'image/png' })] } });
    editor.tiptap.view.dom.dispatchEvent(paste);
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Retry upload of photo.png"]')).not.toBeNull());
    expect(host.querySelector('.verbb-editor__notice')?.textContent).toContain('photo.png didn’t upload. Unable to connect');
    host.querySelector<HTMLButtonElement>('[aria-label="Retry upload of photo.png"]')!.click();
    await vi.waitFor(() => expect(JSON.stringify(editor.getJSON())).toContain('42'));
    // The failure notice goes once nothing has failed.
    expect(host.querySelector('.verbb-editor__notice')?.textContent).toBe('');
    expect(host.querySelector('.ProseMirror img')).toBeNull();
    expect(host.querySelector('.verbb-editor__tray img')?.getAttribute('src')).toBe('/photo.png');
    editor.tiptap.view.dom.dispatchEvent(paste);
    expect(editor.isUploading()).toBe(true);
    editor.setContent('New document');
    expect(requests[2].aborted).toBe(true);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.getText()).toBe('New document'); expect(JSON.stringify(editor.getJSON())).not.toContain('99');
});

it('degrades unknown JSON extensions without losing their useful text', () => {
    const { editor } = mount({ content: [{ type: 'unknownWrapper', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Preserved', marks: [{ type: 'unknownMark' }] }] }] }] });
    expect(editor.getText()).toBe('Preserved');
    expect(editor.getJSON()).toEqual(text('Preserved'));
    expect(editor.isDirty()).toBe(false);
});

it('previews native temporary images without persisting object URLs and releases them on replacement', async () => {
    const createObjectURL = vi.fn(() => 'blob:local-preview');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL; });
    stubUploads(() => ({ status: 200, body: { asset: { id: 71, filename: 'native.png', kind: 'inlineImage', url: null, temporary: true } } }));
    const { editor, host } = mount({ craft, features: { image: true } });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [new File(['photo'], 'native.png', { type: 'image/png' })] } });
    editor.tiptap.view.dom.dispatchEvent(paste);
    // The tray shows the local preview while the file uploads, and keeps it once it's done.
    expect(host.querySelector('.verbb-editor__tray img')?.getAttribute('src')).toBe('blob:local-preview');
    await vi.waitFor(() => expect(editor.isUploading()).toBe(false));
    expect(host.querySelector('.verbb-editor__tray img')?.getAttribute('src')).toBe('blob:local-preview');
    // References only: the URL is never part of what's submitted.
    expect(editor.getJSON().find((node) => node.type === 'editorAsset')?.attrs).toEqual({ id: 71, alt: '', title: 'native.png' });
    expect(JSON.stringify(editor.getJSON())).not.toContain('blob:');
    expect(editor.getHTML()).not.toContain('blob:');
    editor.setContent('Replaced');
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:local-preview');
});

it('accepts native attachments without public URLs and retains their identities', async () => {
    stubUploads(() => ({ status: 200, body: { asset: { id: 72, filename: 'private.pdf', kind: 'attachment', url: null, temporary: true } } }));
    const result = await new CraftClient(craft).uploadAsset(new File(['pdf'], 'private.pdf'), 'attachment');
    expect(result).toMatchObject({ id: 72, url: null, temporary: true });
});
