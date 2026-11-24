import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Editor, registerVerbbEditorElement, registerVerbbEditorInputElement, type VerbbEditorElement, type VerbbEditorInputElement } from '../src';
import { chosen, Giphy, GifPicker, thumbnail, type GifConfig, type GiphyResult } from '../src/gifs/index';

/**
 * GIF search through GIPHY: the browser asks GIPHY itself, uses its results untouched, and sends its
 * pings; the picker any host can place; and the editor's GIF control, whose GIF goes with the document.
 */

registerVerbbEditorElement();
registerVerbbEditorInputElement();

const GIFS: GifConfig = { apiKey: 'giphy-key', rating: 'pg', limit: 12, language: 'en' };

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const result = (id: string): GiphyResult => ({
    id,
    title: `GIF ${id}`,
    images: {
        fixed_width: { url: `https://media1.giphy.com/media/${id}/200w.gif?cid=abc&rid=200w.gif`, webp: `https://media1.giphy.com/media/${id}/200w.webp?cid=abc&rid=200w.webp`, width: '200', height: '150' },
        original: { url: `https://media2.giphy.com/media/${id}/giphy.gif?cid=abc&rid=giphy.gif`, webp: `https://media2.giphy.com/media/${id}/giphy.webp?cid=abc&rid=giphy.webp`, width: '480', height: '360' },
    },
    analytics: {
        onload: { url: `https://giphy-analytics.giphy.com/v2/pingback_simple?action_type=SEEN&id=${id}` },
        onclick: { url: `https://giphy-analytics.giphy.com/v2/pingback_simple?action_type=CLICK&id=${id}` },
        onsent: { url: `https://giphy-analytics.giphy.com/v2/pingback_simple?action_type=SENT&id=${id}` },
    },
});

/** GIPHY, as the browser's own `fetch` reaches it. Every request is kept. */
function giphy(results: GiphyResult[] = [result('b'), result('a')]) {
    const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input instanceof Request ? input.url : input));

        requests.push({ url, init });

        if (url.hostname === 'giphy-analytics.giphy.com') return new Response('', { status: 200 });
        if (url.pathname === '/v1/randomid') return json({ data: { random_id: 'browser-1' } });

        return json({ data: results, pagination: {}, meta: { status: 200 } });
    });

    return { fetcher, requests, of: (path: string) => requests.filter((request) => request.url.pathname === path), pings: (type: string) => requests.filter((request) => request.url.searchParams.get('action_type') === type) };
}

async function settle(until: () => unknown): Promise<void> {
    for (let i = 0; i < 200; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));

        if (until()) return;
    }

    throw new Error(`Timed out waiting: ${String(until)}`);
}

let stubbedGiphy: ReturnType<typeof giphy>;

beforeEach(() => {
    stubbedGiphy = giphy();
    vi.stubGlobal('fetch', stubbedGiphy.fetcher);
    sessionStorage.clear();
});

afterEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    vi.unstubAllGlobals();
});

describe('GIPHY requests', () => {
    it('asks for trending with an empty query and searches otherwise, with the site’s settings and GIPHY’s ID for the browser', async () => {
        const service = new Giphy(GIFS, stubbedGiphy.fetcher);

        await service.search('  ');
        await service.search('x'.repeat(80));

        const [trending] = stubbedGiphy.of('/v1/gifs/trending');
        const [search] = stubbedGiphy.of('/v1/gifs/search');

        expect(Object.fromEntries(trending!.url.searchParams)).toEqual({ api_key: 'giphy-key', limit: '12', rating: 'pg', lang: 'en', bundle: 'messaging_non_clips', customer_id: 'browser-1' });
        expect(search!.url.searchParams.get('q')).toBe('x'.repeat(50));
        expect(trending!.init?.credentials).toBe('omit');
        // The ID is asked for once, and kept for the session.
        expect(stubbedGiphy.of('/v1/randomid')).toHaveLength(1);
        expect(sessionStorage.getItem('verbb-editor-giphy-customer')).toBe('browser-1');
    });

    it('returns GIPHY’s results untouched and in order, and keeps their addresses as they are', async () => {
        const results = [result('b'), result('a'), { id: 'c', images: {} }];
        stubbedGiphy = giphy(results);
        const found = await new Giphy(GIFS, stubbedGiphy.fetcher).search('cats');

        expect(found).toEqual(results);
        expect(thumbnail(found[0]!).url).toBe('https://media1.giphy.com/media/b/200w.webp?cid=abc&rid=200w.webp');
        expect(chosen(found[0]!)).toEqual({ url: 'https://media2.giphy.com/media/b/giphy.webp?cid=abc&rid=giphy.webp', width: 480, height: 360 });
        expect(chosen(found[2]!)).toBeNull();
    });

    it('searches without an ID when GIPHY doesn’t give one', async () => {
        const fetcher = vi.fn(async (input: RequestInfo | URL) => (String(input).includes('/randomid') ? json({ meta: {} }) : json({ data: [] })));
        await new Giphy(GIFS, fetcher).search('');

        expect(new URL(String(fetcher.mock.calls[1]![0])).searchParams.has('customer_id')).toBe(false);
    });

    it('sends a result’s pings with the time and the browser’s ID, without credentials', async () => {
        const service = new Giphy(GIFS, stubbedGiphy.fetcher);
        const item = result('a');
        service.shown(item);
        service.shown(item);
        await settle(() => stubbedGiphy.pings('SEEN').length);

        const [ping] = stubbedGiphy.pings('SEEN');
        expect(stubbedGiphy.pings('SEEN')).toHaveLength(1);
        expect(ping!.url.searchParams.get('customer_id')).toBe('browser-1');
        expect(Number(ping!.url.searchParams.get('ts'))).toBeGreaterThan(0);
        expect(ping!.init).toMatchObject({ mode: 'no-cors', credentials: 'omit', keepalive: true });
    });
});


describe('the GIF picker', () => {
    function picker(options: Partial<ConstructorParameters<typeof GifPicker>[0]> = {}) {
        const onChoose = vi.fn();
        const onClose = vi.fn();
        const instance = new GifPicker({ config: GIFS, onChoose, onClose, fetcher: stubbedGiphy.fetcher, id: 'test', ...options });

        document.body.append(instance.element);

        return { instance, onChoose, onClose };
    }

    it('talks to GIPHY only once opened, then shows trending with the attribution, each result counted once', async () => {
        const { instance } = picker();

        expect(stubbedGiphy.requests).toHaveLength(0);

        instance.open();
        await settle(() => instance.element.querySelectorAll('.verbb-editor__gifs-result').length === 2);

        expect(stubbedGiphy.of('/v1/gifs/trending')).toHaveLength(1);
        expect(document.activeElement).toBe(instance.element.querySelector('.verbb-editor__gifs-search'));
        expect(instance.element.querySelector('.verbb-editor__gifs-attribution')?.textContent).toBe('Powered by GIPHY');
        expect(instance.element.querySelector('label')?.htmlFor).toBe('test-search');
        expect(instance.element.querySelector<HTMLImageElement>('.verbb-editor__gifs-image')?.getAttribute('src')).toBe('https://media1.giphy.com/media/b/200w.webp?cid=abc&rid=200w.webp');

        await settle(() => stubbedGiphy.pings('SEEN').length === 2);
        instance.open();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(stubbedGiphy.pings('SEEN')).toHaveLength(2);
    });

    it('searches straight away on Enter, which never reaches a form around it, and Escape asks to close', async () => {
        const { instance, onClose } = picker();
        const form = document.createElement('form');
        const submitted = vi.fn((event: Event) => event.preventDefault());
        const input = instance.element.querySelector<HTMLInputElement>('.verbb-editor__gifs-search')!;

        form.addEventListener('submit', submitted);
        form.append(instance.element);
        document.body.append(form);
        input.value = 'cats';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await settle(() => stubbedGiphy.of('/v1/gifs/search').length);

        expect(stubbedGiphy.of('/v1/gifs/search')[0]!.url.searchParams.get('q')).toBe('cats');
        expect(submitted).not.toHaveBeenCalled();

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('hands over the largest rendition when a result is chosen, and tells GIPHY', async () => {
        const { instance, onChoose } = picker();

        instance.open();
        await settle(() => instance.element.querySelector('.verbb-editor__gifs-result'));
        instance.element.querySelector<HTMLElement>('.verbb-editor__gifs-image')!.click();

        expect(onChoose).toHaveBeenCalledWith({ gif: { url: 'https://media2.giphy.com/media/b/giphy.webp?cid=abc&rid=giphy.webp', width: 480, height: 360 }, sent: 'https://giphy-analytics.giphy.com/v2/pingback_simple?action_type=SENT&id=b' });

        await settle(() => stubbedGiphy.pings('CLICK').length);
    });

    it('says when nothing is found or GIPHY fails, and takes a host’s own classes', async () => {
        stubbedGiphy = giphy([]);

        const { instance } = picker({ fetcher: stubbedGiphy.fetcher, classes: { picker: 'host-picker', status: 'host-status', hidden: 'host-hidden' }, labels: { gifEmpty: 'Nothing here.' } });

        instance.open();
        await settle(() => instance.element.querySelector('.host-status')?.textContent);

        expect(instance.element.className).toBe('host-picker');
        expect(instance.element.querySelector('label')?.className).toBe('host-hidden');
        expect(instance.element.querySelector('.host-status')?.textContent).toBe('Nothing here.');

        const failing = new GifPicker({ config: GIFS, onChoose: vi.fn(), fetcher: async () => new Response('', { status: 500 }) });

        document.body.append(failing.element);
        failing.open();
        await settle(() => failing.element.querySelector('.verbb-editor__gifs-status')?.textContent);

        expect(failing.element.querySelector('.verbb-editor__gifs-status')?.textContent).toBe('GIFs can’t be loaded right now.');
    });
});

describe('the editor’s GIF control', () => {
    function mount(options: ConstructorParameters<typeof Editor>[1] = {}) {
        const host = document.createElement('div');

        document.body.append(host);

        return { editor: new Editor(host, { gifs: GIFS, ...options }), host };
    }

    const control = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.verbb-editor__toolbar [data-command="gif"]');

    it('joins the toolbar’s insert controls only with GIPHY’s key', () => {
        expect(control(mount().host)?.getAttribute('aria-label')).toBe('Add a GIF');
        expect(control(mount().host)?.getAttribute('aria-haspopup')).toBe('dialog');
        expect(control(mount({ gifs: false }).host)).toBeNull();
        expect(control(mount({ gifs: { apiKey: '' } }).host)).toBeNull();
    });

    it('opens GIF search above the control, and a chosen GIF goes with the document rather than inside it', async () => {
        const changes: Array<{ gif: unknown; isDirty: boolean }> = [];
        const { editor, host } = mount({ onChange: ({ gif, isDirty }) => changes.push({ gif, isDirty }) });

        control(host)!.click();
        await settle(() => host.querySelector('.verbb-editor__pop--gifs .verbb-editor__gifs-result'));

        const popover = host.querySelector('.verbb-editor__pop--gifs')!;

        expect(popover.getAttribute('role')).toBe('dialog');
        expect(control(host)?.getAttribute('aria-expanded')).toBe('true');

        popover.querySelector<HTMLElement>('.verbb-editor__gifs-result')!.click();

        expect(host.querySelector('.verbb-editor__pop--gifs')).toBeNull();
        expect(editor.getGif()).toEqual({ url: 'https://media2.giphy.com/media/b/giphy.webp?cid=abc&rid=giphy.webp', width: 480, height: 360 });
        expect(editor.getJSON()).toEqual([]);
        expect(editor.isEmpty()).toBe(true);
        expect(editor.isDirty()).toBe(true);
        expect(changes.at(-1)).toEqual({ gif: editor.getGif(), isDirty: true });
        expect(host.querySelector<HTMLImageElement>('.verbb-editor__gif-image')?.getAttribute('src')).toBe(editor.getGif()!.url);

        editor.reportGifSent();
        await settle(() => stubbedGiphy.pings('SENT').length);
        editor.reportGifSent();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(stubbedGiphy.pings('SENT')).toHaveLength(1);

        host.querySelector<HTMLButtonElement>('.verbb-editor__gif .verbb-editor__remove')!.click();

        expect(editor.getGif()).toBeNull();
        expect(host.querySelector<HTMLElement>('.verbb-editor__gif')?.hidden).toBe(true);
        expect(editor.isDirty()).toBe(false);
    });

    it('starts with a given GIF, keeps it as the baseline, and resets to it', () => {
        const gif = { url: 'https://media.giphy.com/media/x/giphy.gif', width: 200, height: 100 };
        const { editor } = mount({ gif });

        expect(editor.getGif()).toEqual(gif);
        expect(editor.isDirty()).toBe(false);

        editor.setGif(null);

        expect(editor.isDirty()).toBe(true);

        editor.reset();

        expect(editor.getGif()).toEqual(gif);

        editor.reset([], null);

        expect(editor.getGif()).toBeNull();
        expect(editor.isDirty()).toBe(false);

        editor.setGif({ url: 'https://media.giphy.com/media/y/giphy.gif', width: -1, height: Number.NaN });

        expect(editor.getGif()).toEqual({ url: 'https://media.giphy.com/media/y/giphy.gif', width: null, height: null });
    });

    it('lets the editor post a GIF on its own and keeps it in the draft', async () => {
        const element = document.createElement('verbb-editor') as VerbbEditorElement;
        const form = document.createElement('form');

        element.setAttribute('draft-key', 'gif-draft');
        element.setAttribute('submit-label', 'Post');
        element.options = { gifs: GIFS };
        form.append(element);
        document.body.append(form);

        const editor = await element.ready;

        const button = element.querySelector<HTMLButtonElement>('.verbb-editor__submit')!;

        expect(button.getAttribute('aria-disabled')).toBe('true');

        editor.setGif({ url: 'https://media.giphy.com/media/x/giphy.gif', width: 200, height: 100 });

        expect(button.getAttribute('aria-disabled')).toBe('false');
        expect(element.querySelector('.verbb-editor')?.classList.contains('is-collapsed')).toBe(false);

        await settle(() => localStorage.getItem('verbb-editor-draft:gif-draft'));

        expect(JSON.parse(localStorage.getItem('verbb-editor-draft:gif-draft')!).gif).toEqual({ url: 'https://media.giphy.com/media/x/giphy.gif', width: 200, height: 100 });
    });

    it('submits the GIF with a form under its own name, beside the document', async () => {
        const element = document.createElement('verbb-editor-input') as VerbbEditorInputElement;
        const form = document.createElement('form');

        element.setAttribute('name', 'body');
        element.setAttribute('gif-name', 'gif');
        element.toggleAttribute('required', true);
        element.options = { gifs: GIFS };
        form.append(element);
        document.body.append(form);

        const editor = await element.ready;

        expect(new FormData(form).has('gif')).toBe(false);

        editor.setGif({ url: 'https://media.giphy.com/media/x/giphy.gif', width: 200, height: 100 });

        const data = new FormData(form);

        expect(JSON.parse(String(data.get('gif')))).toEqual({ url: 'https://media.giphy.com/media/x/giphy.gif', width: 200, height: 100 });
        expect(data.get('body')).toBe('');
        expect(element.validity?.valid ?? true).toBe(true);
    });
});
