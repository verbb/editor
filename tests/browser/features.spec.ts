import { expect, test, type Page } from '@playwright/test';

/** The feature chunks this page has requested, by name. */
function chunksRequested(page: Page): string[] {
    const names: string[] = [];

    page.on('request', (request) => {
        const match = new URL(request.url()).pathname.match(/^\/dist\/(link-tools|link|mention|uploads)-[\w-]{8}\.js$/);

        if (match) names.push(match[1]);
    });

    return names;
}

/**
 * A host page that loads Editor the way Craft and Comments do: a module script carrying the page's
 * nonce, at a URL with Craft's cache-busting query.
 */
async function hostPage(page: Page, markup: string, policy?: string): Promise<void> {
    await page.addInitScript(() => {
        const record = window as unknown as { violations: string[]; failures: string[] };

        record.violations = [];
        record.failures = [];
        document.addEventListener('securitypolicyviolation', (event) => record.violations.push(`${event.violatedDirective} ${event.blockedURI}`));
        document.addEventListener('editor-error', (event) => record.failures.push(String((event as CustomEvent).detail.error.message)));
    });
    await page.route('**/host', (route) => route.fulfill({
        contentType: 'text/html',
        headers: policy ? { 'content-security-policy': policy } : {},
        body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Host</title><link rel="stylesheet" href="/dist/editor.css"><script type="module" nonce="n0nce" src="/dist/editor.js?v=1"></script></head><body>${markup}</body></html>`,
    }));
    await page.goto('/host');
}

function editorWith(options: Record<string, unknown>): string {
    return `<verbb-editor data-options='${JSON.stringify(options)}'></verbb-editor>`;
}

/** Waits for every editor on the page, giving each one's result: mounted, or why it failed. */
function settled(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
        await customElements.whenDefined('verbb-editor');

        return Promise.all([...document.querySelectorAll<HTMLElement & { ready: Promise<unknown> }>('verbb-editor')]
            .map((element) => element.ready.then(() => 'mounted', (error: Error) => error.message)));
    });
}

const COMMENTS_DEFAULT = { preset: 'minimal', features: { strike: true, lists: true, blockquote: true, code: true, link: true, mention: true } };

test.describe('features load on demand', () => {
    test('an editor without links, mentions or uploads loads no feature chunk', async ({ page }) => {
        const chunks = chunksRequested(page);

        await hostPage(page, editorWith({ preset: 'minimal' }));

        expect(await settled(page)).toEqual(['mounted']);
        expect(chunks).toEqual([]);
    });

    test('loads only the chunks an editor’s features use, once for every editor on the page', async ({ page }) => {
        const chunks = chunksRequested(page);

        await hostPage(page, editorWith(COMMENTS_DEFAULT) + editorWith(COMMENTS_DEFAULT));

        expect(await settled(page)).toEqual(['mounted', 'mounted']);
        expect(chunks.sort()).toEqual(['link', 'link-tools', 'mention']);
        await expect(page.locator('.ProseMirror')).toHaveCount(2);

        await page.evaluate(() => {
            document.body.insertAdjacentHTML('beforeend', `<verbb-editor data-options='${JSON.stringify({ preset: 'minimal', features: { image: true } })}'></verbb-editor>`);
        });

        expect(await settled(page)).toEqual(['mounted', 'mounted', 'mounted']);
        expect(chunks.sort()).toEqual(['link', 'link-tools', 'mention', 'uploads']);
    });

    test('runs one copy of Editor when its URL carries a query, as Craft serves it', async ({ page }) => {
        const entries: string[] = [];

        page.on('request', (request) => {
            if (new URL(request.url()).pathname === '/dist/editor.js') entries.push(request.url());
        });
        await hostPage(page, editorWith(COMMENTS_DEFAULT));

        expect(await settled(page)).toEqual(['mounted']);
        // A chunk importing `./editor.js` would fetch it again without the query and run a second copy.
        expect(entries).toEqual([expect.stringMatching(/\/dist\/editor\.js\?v=1$/)]);
    });

    test('a host that loads the features first gets an editor the moment it adds the element', async ({ page }) => {
        await hostPage(page, '');

        const mounted = await page.evaluate(async (options) => {
            await customElements.whenDefined('verbb-editor');

            const Element = customElements.get('verbb-editor') as unknown as { loadFeatures(options: unknown): Promise<void> };

            await Element.loadFeatures(options);

            const element = document.createElement('verbb-editor') as HTMLElement & { editor: unknown };

            element.setAttribute('data-options', JSON.stringify(options));
            document.body.append(element);

            return element.editor !== null;
        }, COMMENTS_DEFAULT);

        expect(mounted).toBe(true);
    });

    test('a chunk that fails to load leaves the editor unmounted and says why', async ({ page }) => {
        await page.route(/\/dist\/mention-[\w-]+\.js$/, (route) => route.abort());
        await hostPage(page, editorWith(COMMENTS_DEFAULT));

        expect(await settled(page)).toEqual(['Editor’s mention feature couldn’t be loaded.']);
        expect(await page.evaluate(() => (window as unknown as { failures: string[] }).failures)).toEqual(['Editor’s mention feature couldn’t be loaded.']);
        await expect(page.locator('.ProseMirror')).toHaveCount(0);
    });

    for (const policy of ["script-src 'nonce-n0nce'", "script-src 'nonce-n0nce' 'strict-dynamic'"]) {
        test(`loads every chunk under \`${policy}\``, async ({ page }) => {
            const chunks = chunksRequested(page);

            await hostPage(page, editorWith({ preset: 'standard', features: { craftLink: true, mention: true, image: true, attachment: true } }), policy);

            expect(await settled(page)).toEqual(['mounted']);
            expect(chunks.sort()).toEqual(['link', 'link-tools', 'mention', 'uploads']);
            expect(await page.evaluate(() => (window as unknown as { violations: string[] }).violations)).toEqual([]);
        });
    }
});

test.describe('GIF search', () => {
    const gif = (id: string) => ({
        id,
        title: `GIF ${id}`,
        images: {
            fixed_width: { url: `https://media1.giphy.com/media/${id}/200w.gif`, width: '200', height: '150' },
            original: { url: `https://media2.giphy.com/media/${id}/giphy.gif`, width: '480', height: '360' },
        },
        analytics: { onload: { url: `https://giphy-analytics.giphy.com/ping?action_type=SEEN&id=${id}` }, onclick: { url: `https://giphy-analytics.giphy.com/ping?action_type=CLICK&id=${id}` }, onsent: { url: `https://giphy-analytics.giphy.com/ping?action_type=SENT&id=${id}` } },
    });

    test('loads its chunk only when opened, in a popover above the control, and shows the chosen GIF under the text', async ({ page }) => {
        const chunks: string[] = [];
        const giphy: string[] = [];

        page.on('request', (request) => {
            if (/^\/dist\/gifs-[\w-]{8}\.js$/.test(new URL(request.url()).pathname)) chunks.push(request.url());
        });
        // A 1×1 PNG stands in for each GIF, so nothing leaves the test. Playwright tries the latest
        // route first, so GIPHY's API is routed after this.
        await page.route('https://*.giphy.com/**', (route) => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }));
        await page.route('https://api.giphy.com/**', async (route) => {
            giphy.push(new URL(route.request().url()).pathname);
            await route.fulfill({ json: route.request().url().includes('/randomid') ? { data: { random_id: 'browser-1' } } : { data: [gif('a'), gif('b'), gif('c')] } });
        });
        await page.goto('/');
        await page.evaluate(async () => {
            document.body.innerHTML = '<div style="padding:420px 20px 20px"><div id="editor"></div></div>';

            const { Editor } = await import('/dist/editor.js' as string);

            (window as unknown as { editor: unknown }).editor = await Editor.create('#editor', { gifs: { apiKey: 'giphy-key' } });
        });

        expect(chunks).toEqual([]);
        expect(giphy).toEqual([]);

        const control = page.locator('[data-command="gif"]');

        await control.click();

        const popover = page.getByRole('dialog', { name: 'Search GIPHY' });

        await expect(popover.locator('.verbb-editor__gifs-result')).toHaveCount(3);
        await expect(page.getByRole('searchbox', { name: 'Search GIPHY' })).toBeFocused();
        await expect(control).toHaveAttribute('aria-expanded', 'true');
        await expect(popover.getByText('Powered by GIPHY')).toBeVisible();
        expect(chunks).toHaveLength(1);

        // Above the control, inside the page.
        const box = (await popover.boundingBox())!;
        const button = (await control.boundingBox())!;

        expect(box.y + box.height).toBeLessThanOrEqual(button.y);
        expect(box.x).toBeGreaterThanOrEqual(0);

        await page.keyboard.press('Escape');
        await expect(popover).toHaveCount(0);
        await expect(control).toBeFocused();

        await control.click();
        await popover.locator('.verbb-editor__gifs-result').nth(1).click();

        await expect(popover).toHaveCount(0);
        await expect(page.locator('.verbb-editor__gif-image')).toHaveAttribute('src', 'https://media2.giphy.com/media/b/giphy.gif');
        expect(await page.evaluate(() => (window as unknown as { editor: { getGif(): unknown } }).editor.getGif())).toEqual({ url: 'https://media2.giphy.com/media/b/giphy.gif', width: 480, height: 360 });
        expect(chunks).toHaveLength(1);

        await page.locator('.verbb-editor__gif-frame').hover();
        await page.getByRole('button', { name: 'Remove GIF' }).click();
        await expect(page.locator('.verbb-editor__gif-image')).toHaveCount(0);
    });

    test('fits its frame to the shown GIF, so Remove sits on its corner, however wide or narrow', async ({ page }) => {
        // An SVG of each size stands in for the GIF, since the frame follows the image's own size.
        await page.route('https://media.giphy.com/**', (route) => {
            const [width, height] = new URL(route.request().url()).pathname.split('/')[2].split('x');

            return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/></svg>` });
        });
        await page.goto('/');
        await page.evaluate(async () => {
            document.body.innerHTML = '<div id="host" style="width:600px"><div id="editor"></div></div>';

            const { Editor } = await import('/dist/editor.js' as string);

            (window as unknown as { editor: unknown }).editor = await Editor.create('#editor', { gifs: { apiKey: 'giphy-key' } });
        });

        const measure = async (width: number, height: number, hostWidth = 600) => page.evaluate(async ([gifWidth, gifHeight, host]) => {
            document.getElementById('host')!.style.width = `${host}px`;
            (window as unknown as { editor: { setGif(gif: unknown): void } }).editor.setGif({ url: `https://media.giphy.com/media/${gifWidth}x${gifHeight}/giphy.gif`, width: gifWidth, height: gifHeight });

            const image = document.querySelector<HTMLImageElement>('.verbb-editor__gif-image')!;

            await image.decode();

            const frame = document.querySelector('.verbb-editor__gif-frame')!.getBoundingClientRect();
            const shown = image.getBoundingClientRect();
            const remove = document.querySelector('.verbb-editor__gif-frame .verbb-editor__remove')!.getBoundingClientRect();

            return { frame: Math.round(frame.width), image: Math.round(shown.width), height: Math.round(shown.height), gap: Math.round(shown.right - remove.right) };
        }, [width, height, hostWidth]);

        // Wide, tall and small GIFs, and a wide one in a narrow editor.
        expect(await measure(480, 270)).toEqual({ frame: 192, image: 192, height: 108, gap: 4 });
        expect(await measure(270, 480)).toEqual({ frame: 108, image: 108, height: 192, gap: 4 });
        expect(await measure(100, 60)).toEqual({ frame: 100, image: 100, height: 60, gap: 4 });
        expect(await measure(480, 270, 140)).toEqual({ frame: 110, image: 110, height: 62, gap: 4 });

        // The cross sits in the middle of its circle, with no padding from the browser pushing it aside.
        expect(await page.evaluate(() => {
            const remove = document.querySelector('.verbb-editor__gif-frame .verbb-editor__remove')!;
            const circle = remove.getBoundingClientRect();
            const cross = remove.querySelector('svg')!.getBoundingClientRect();

            return [cross.x + cross.width / 2 - (circle.x + circle.width / 2), cross.y + cross.height / 2 - (circle.y + circle.height / 2)];
        })).toEqual([0, 0]);
    });
});
