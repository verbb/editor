import { expect, test } from '@playwright/test';

import { craft, expectNoSubmit, json, mentionResponse, mountEditor, openPage, PNG, routeMentions, textbox } from './helpers';

const text = (value: string) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });

test.describe('loading the bundle', () => {
    test('works as a module, with a global, the element and Tiptap', async ({ page }) => {
        await page.goto('/');

        const result = await page.evaluate(async () => {
            const module = await import('/dist/editor.js');

            return {
                exports: Object.keys(module),
                api: Object.keys((window as unknown as { VerbbEditor: object }).VerbbEditor).sort(),
                global: typeof (window as unknown as { VerbbEditor?: { Editor?: unknown } }).VerbbEditor?.Editor,
                element: !!customElements.get('verbb-editor') && !!customElements.get('verbb-editor-input'),
            };
        });

        const ruled = ['Editor', 'Tiptap', 'VerbbEditorElement', 'VerbbEditorInputElement', 'loadFeatures', 'registerVerbbEditorElement', 'registerVerbbEditorInputElement'];

        expect(result.exports.sort()).toEqual(ruled);
        expect(result.api).toEqual(ruled);
        expect(result.global).toBe('function');
        expect(result.element).toBe(true);
    });

    test('classic glue can wait for the element', async ({ page }) => {
        await page.goto('/');

        const seen = await page.evaluate(async () => {
            const script = document.createElement('script');
            script.type = 'module';
            script.src = '/dist/editor.js';
            document.head.append(script);
            await customElements.whenDefined('verbb-editor');

            return typeof (window as unknown as { VerbbEditor?: unknown }).VerbbEditor;
        });

        expect(seen).toBe('object');
    });

    test('runs an extension built through the re-exported Tiptap on one instance', async ({ page }) => {
        await openPage(page, '<div id="editor"></div>');

        const html = await page.evaluate(async () => {
            const { VerbbEditor } = window as unknown as { VerbbEditor: any };
            const Callout = VerbbEditor.Tiptap.Node.create({
                name: 'callout',
                group: 'block',
                content: 'block+',
                parseHTML: () => [{ tag: 'section' }],
                renderHTML: () => ['section', 0],
            });
            const editor = await VerbbEditor.Editor.create('#editor', {
                extensions: [Callout],
                content: [{ type: 'callout', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] }],
            });

            return editor.getHTML();
        });

        expect(html).toBe('<section><p>Hi</p></section>');
    });

    test('applies under a strict style policy', async ({ page }) => {
        await page.route('/', async (route) => {
            const response = await route.fetch();

            await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "style-src 'self'" } });
        });

        const violations: string[] = [];

        page.on('console', (message) => {
            if (message.type() === 'error') violations.push(message.text());
        });

        await mountEditor(page, { content: [text('Styled')] });
        await expect(textbox(page)).toContainText('Styled');
        expect(violations).toEqual([]);
    });
});

test.describe('native forms', () => {
    const form = '<form id="f"><label for="body">Your message</label><verbb-editor id="body" name="body" required></verbb-editor><button type="submit">Send</button><button type="reset">Reset</button></form>';

    const formValue = (page: import('@playwright/test').Page) => page.evaluate(() => new FormData(document.querySelector('form')!).get('body'));

    test('submits the document and keeps an empty field out of the JSON', async ({ page }) => {
        await openPage(page, form);
        expect(await formValue(page)).toBe('');

        await textbox(page).click();
        await page.keyboard.type('Hello');
        expect(JSON.parse(String(await formValue(page)))).toEqual([text('Hello')]);
    });

    test('requires visible content, and whitespace is not enough', async ({ page }) => {
        await openPage(page, form);

        const validity = () => page.evaluate(() => document.querySelector('form')!.checkValidity());

        expect(await validity()).toBe(false);
        await expect(textbox(page)).toHaveAttribute('aria-required', 'true');
        await expect(textbox(page)).toHaveAttribute('aria-invalid', 'true');

        await textbox(page).click();
        await page.keyboard.type('   ');
        expect(await validity()).toBe(false);

        await page.keyboard.type('x');
        expect(await validity()).toBe(true);
        await expect(textbox(page)).not.toHaveAttribute('aria-invalid');
    });

    test('resets to the starting document', async ({ page }) => {
        await openPage(page, form);
        await textbox(page).click();
        await page.keyboard.type('Hello');
        await page.locator('button[type=reset]').click();
        expect(await formValue(page)).toBe('');
    });

    test('joins disabled fieldsets', async ({ page }) => {
        await openPage(page, '<form><fieldset disabled><verbb-editor name="body"></verbb-editor></fieldset></form>');
        await expect(textbox(page)).toHaveAttribute('contenteditable', 'false');
        expect(await page.evaluate(() => new FormData(document.querySelector('form')!).has('body'))).toBe(false);
    });

    test('is named by its label, and a label click focuses it', async ({ page }) => {
        await openPage(page, form);
        await expect(page.getByRole('textbox', { name: 'Your message' })).toHaveCount(1);

        await page.locator('label').click();
        await expect(textbox(page)).toBeFocused();
    });

    test('takes focus through the host', async ({ page }) => {
        await openPage(page, form);
        await page.evaluate(() => document.querySelector<HTMLElement>('verbb-editor')!.focus());
        await expect(textbox(page)).toBeFocused();
    });

    test('keeps the same editor and focus when attributes change', async ({ page }) => {
        await openPage(page, form);
        await textbox(page).click();
        await page.keyboard.type('Draft');

        const changed = await page.evaluate(() => {
            const element = document.querySelector('verbb-editor')!;
            const before = element.editor;
            let events = 0;

            element.addEventListener('editor-update', () => events++);
            element.setAttribute('placeholder', 'New');
            element.setAttribute('name', 'other');
            element.toggleAttribute('required');

            return { same: element.editor === before, events };
        });

        expect(changed).toEqual({ same: true, events: 0 });
        await expect(textbox(page)).toBeFocused();
    });
});

test.describe('undo', () => {
    test('does not undo past the loaded document', async ({ page }) => {
        await mountEditor(page, { content: [text('Loaded')] });
        await textbox(page).click();
        await page.keyboard.press('ControlOrMeta+z');
        await expect(textbox(page)).toHaveText('Loaded');
        expect(await page.evaluate(() => (window as any).editor.isDirty())).toBe(false);
    });

    test('reset ends history', async ({ page }) => {
        await mountEditor(page, { content: [text('Loaded')] });
        await textbox(page).click();
        await page.keyboard.type('more');
        await page.evaluate(() => (window as any).editor.reset([{ type: 'paragraph', content: [{ type: 'text', text: 'Saved' }] }]));
        await textbox(page).click();
        await page.keyboard.press('ControlOrMeta+z');
        await expect(textbox(page)).toHaveText('Saved');
    });
});

test.describe('link', () => {
    const inForm = '<form id="f"><div id="editor"></div><button>Send</button></form>';
    const pages = { results: [
        { id: 5, type: 'craft\\elements\\Entry', label: 'Story', description: 'News', url: '/news/story' },
        { id: 6, type: 'craft\\elements\\Entry', label: 'Other story', url: '/other' },
    ] };

    async function countSubmits(page: import('@playwright/test').Page): Promise<void> {
        await page.evaluate(() => {
            (window as any).submits = 0;
            document.querySelector('form')!.addEventListener('submit', (event) => {
                event.preventDefault();
                (window as any).submits++;
            });
        });
    }

    async function selectAllAndLink(page: import('@playwright/test').Page): Promise<void> {
        await textbox(page).click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('ControlOrMeta+k');
    }

    test('one control searches pages, suggests some before typing, and stores a page reference', async ({ page }) => {
        const queries: string[] = [];

        await page.route('**/elements/search', async (route) => {
            queries.push(route.request().postDataJSON().query);
            await route.fulfill({ json: pages });
        });
        await mountEditor(page, { features: { link: true, craftLink: true }, craft, content: [text('Linked')] }, inForm);
        await countSubmits(page);
        await selectAllAndLink(page);

        const popover = page.locator('.verbb-editor__pop--link');

        await expect(popover.getByRole('combobox', { name: 'Link address or page' })).toBeFocused();
        await expect(popover).toContainText('Suggested pages');
        await expect(popover.getByRole('option', { name: /Story News · \/news\/story/ })).toBeVisible();
        await page.keyboard.type('Sto');
        await expect(popover).toContainText('Pages on this site');
        await page.keyboard.press('Enter');
        await expectNoSubmit(page);
        expect(queries).toEqual(['', 'Sto']);

        const [node] = await json(page) as any[];

        expect(node.content[0].marks).toEqual([{ type: 'craftLink', attrs: { id: 5, type: 'craft\\elements\\Entry', label: 'Story' } }]);
        await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', '/news/story');
    });

    test('a pasted address is offered first and stores an ordinary link', async ({ page }) => {
        await page.route('**/elements/search', (route) => route.fulfill({ json: pages }));
        await mountEditor(page, { features: { link: true, craftLink: true }, craft, content: [text('Route')] });
        await selectAllAndLink(page);
        await page.keyboard.type('strava.com/routes/2231');

        const option = page.locator('.verbb-editor__pop--link').getByRole('option').first();

        await expect(option).toContainText('Link to strava.com/routes/2231');
        await expect(option).toContainText('Web address');
        await page.keyboard.press('Enter');
        await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', 'https://strava.com/routes/2231');
    });

    test('takes addresses only, without page search, when Craft links are off', async ({ page }) => {
        await mountEditor(page, { content: [text('Site')] });

        const save = async (value: string) => {
            await selectAllAndLink(page);
            await expect(page.getByRole('combobox')).toHaveAttribute('placeholder', 'Paste or type a link');
            await page.keyboard.type(value);
            await page.keyboard.press('Enter');
        };

        await save('example.com');
        await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', 'https://example.com');
        await save('me@example.com');
        await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', 'mailto:me@example.com');
        await save('/about');
        await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', '/about');
    });

    test('refuses unsafe input, and Enter never submits the form', async ({ page }) => {
        await page.route('**/elements/search', (route) => route.fulfill({ json: { results: [] } }));
        await mountEditor(page, { features: { link: true, craftLink: true }, craft, content: [text('Site')] }, inForm);
        await countSubmits(page);
        await selectAllAndLink(page);
        await page.keyboard.type('javascript:alert(1)');
        await page.keyboard.press('Enter');
        await expect(page.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
        await expectNoSubmit(page);
        await expect(page.locator('.ProseMirror a')).toHaveCount(0);

        await page.getByRole('combobox').fill('Nothing');
        await expect(page.locator('.verbb-editor__pop--link')).toContainText('No pages match “Nothing”');
        await page.keyboard.press('Enter');
        await expectNoSubmit(page);
        await page.keyboard.press('Escape');
        await expect(page.locator('.verbb-editor__pop--link')).toHaveCount(0);
        await expect(textbox(page)).toBeFocused();
    });

    test('offers Remove only for an existing link, and shows where a link goes', async ({ page }) => {
        await mountEditor(page, { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Docs', marks: [{ type: 'link', attrs: { href: 'https://verbb.io/docs' } }] }, { type: 'text', text: ' here' }] }] });
        await textbox(page).click();
        await page.keyboard.press('End');
        await page.keyboard.press('ControlOrMeta+k');
        await expect(page.getByRole('button', { name: 'Remove link' })).toHaveCount(0);
        await page.keyboard.press('Escape');

        // The caret inside the link shows its card.
        await page.locator('.ProseMirror a').click({ position: { x: 8, y: 6 } });

        const card = page.locator('.verbb-editor__link-card');

        await expect(card).toContainText('verbb.io/docs');
        await expect(card.locator('a')).toHaveAttribute('target', '_blank');
        await card.getByRole('button', { name: 'Edit link' }).click();
        await page.getByRole('button', { name: 'Remove link' }).click();
        await expect(page.locator('.ProseMirror a')).toHaveCount(0);
    });

    test('floats the common marks over a selection', async ({ page }) => {
        await mountEditor(page, { preset: 'standard', content: [text('Select these words')] });
        await textbox(page).click();
        await page.keyboard.press('Home');
        await page.keyboard.press('Shift+End');

        const bubble = page.getByRole('toolbar', { name: 'Format selection' });

        await expect(bubble).toBeVisible();
        await bubble.getByRole('button', { name: 'Bold' }).click();
        expect((await json(page) as any[])[0].content.some((part: any) => part.marks?.[0]?.type === 'bold')).toBe(true);
        await expect(bubble.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.press('ArrowRight');
        await expect(bubble).toHaveCount(0);
    });
});

test.describe('mentions', () => {
    const options = { features: { mention: true }, craft };

    test('searches with the context, token and scope, and inserts a reference', async ({ page }) => {
        const requests: { url: string; body: any; csrf?: string }[] = [];

        await page.route('**/mentions/search', async (route) => {
            requests.push({ url: route.request().url(), body: route.request().postDataJSON(), csrf: route.request().headers()['x-csrf-token'] });
            await route.fulfill({ json: mentionResponse(['Alice', 'Alan']) });
        });
        await mountEditor(page, options);
        await textbox(page).click();
        await page.keyboard.type('@Al');
        await expect(page.getByRole('option', { name: 'Alice' })).toBeVisible();

        const last = requests[requests.length - 1];

        expect(last.url).toContain('p=actions/verbb-editor/mentions/search');
        expect(last.csrf).toBe('token-value');
        expect(last.body).toMatchObject({ query: 'Al', context: 'sample.reply', scope: { ownerId: 7 }, CRAFT_CSRF_TOKEN: 'token-value' });

        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');

        const [node] = await json(page) as any[];

        expect(node.content[0]).toEqual({ type: 'mention', attrs: { id: 2, type: 'craft\\elements\\User', label: 'Alan' } });
    });

    test('scrolls the selection into view and stays on screen', async ({ page }) => {
        await page.setViewportSize({ width: 800, height: 400 });
        await routeMentions(page, () => mentionResponse(Array.from({ length: 30 }, (_, index) => `Person ${index}`)));
        await mountEditor(page, options, '<div style="height:300px"></div><div id="editor"></div>');
        await textbox(page).click();
        await page.keyboard.type('@Pe');
        await expect(page.getByRole('option').first()).toBeVisible();

        const box = await page.locator('.verbb-editor__suggestions').boundingBox();

        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(400);

        for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');

        await expect(page.getByRole('option', { name: 'Person 20', exact: true })).toBeInViewport();
    });

    test('Escape closes the menu and stops searching', async ({ page }) => {
        const queries = await routeMentions(page, () => mentionResponse(['Alice']));

        await mountEditor(page, options);
        await textbox(page).click();
        await page.keyboard.type('@Al');
        await expect(page.getByRole('option', { name: 'Alice' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.verbb-editor__suggestions')).toHaveCount(0);

        const before = queries.length;

        await page.keyboard.type('ice');
        await page.waitForTimeout(350);
        expect(queries.length).toBe(before);
        await expect(page.locator('.verbb-editor__suggestions')).toHaveCount(0);
    });

    test('closes on blur', async ({ page }) => {
        await routeMentions(page, () => mentionResponse(['Alice']));
        await mountEditor(page, options, '<input id="other"><div id="editor"></div>');
        await textbox(page).click();
        await page.keyboard.type('@Al');
        await expect(page.getByRole('option', { name: 'Alice' })).toBeVisible();
        await page.locator('#other').click();
        await expect(page.locator('.verbb-editor__suggestions')).toHaveCount(0);
    });

    test('asks for suggestions on @ and does not search below the minimum length', async ({ page }) => {
        const queries = await routeMentions(page, () => mentionResponse([]));

        await mountEditor(page, { ...options, craft: { ...craft, minQueryLength: 2 } });
        await textbox(page).click();
        await page.keyboard.type('@');
        await expect(page.locator('.verbb-editor__suggestions')).toContainText('Keep typing to search.');
        await page.keyboard.type('A');
        await page.waitForTimeout(300);
        expect(queries).toEqual(['']);
    });

    test('shows suggested people with their description and avatar, then filters them by name', async ({ page }) => {
        const queries = await routeMentions(page, (query) => (query === '' ? {
            results: [
                { id: 1, type: 'craft\\elements\\User', label: 'Priya Shah', description: 'Author', imageUrl: '/dist/editor.css' },
                { id: 2, type: 'craft\\elements\\User', label: 'Alex Morgan', description: 'Commented 3 h ago' },
            ],
        } : mentionResponse(['Priya Shah'])));

        await mountEditor(page, { ...options, craft: { ...craft, minQueryLength: 2 } });
        await textbox(page).click();
        await page.keyboard.type('@');
        await expect(page.locator('.verbb-editor__suggestions')).toContainText('Suggested people');
        await expect(page.getByRole('option', { name: 'Priya Shah, Author' })).toBeVisible();
        await expect(page.locator('.verbb-editor__avatar img')).toHaveCount(1);
        await expect(page.locator('.verbb-editor__avatar').nth(1)).toHaveText('AM');

        // Below the minimum length the suggestions narrow by name without another request.
        await page.keyboard.type('A');
        await expect(page.getByRole('option')).toHaveCount(1);
        await expect(page.getByRole('option', { name: 'Alex Morgan, Commented 3 h ago' })).toBeVisible();
        expect(queries).toEqual(['']);

        await page.keyboard.press('Enter');

        const [node] = await json(page) as any[];

        expect(node.content[0]).toEqual({ type: 'mention', attrs: { id: 2, type: 'craft\\elements\\User', label: 'Alex Morgan' } });
    });

    test('Enter during a search does not abandon the mention', async ({ page }) => {
        await page.route('**/mentions/search', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 400));
            await route.fulfill({ json: mentionResponse(['Alice']) });
        });
        await mountEditor(page, options);
        await textbox(page).click();
        await page.keyboard.type('@Al');
        await page.keyboard.press('Enter');
        await expect(textbox(page).locator('p')).toHaveCount(1);
        await expect(page.getByRole('option', { name: 'Alice' })).toBeVisible();
    });

    test('ignores stale responses', async ({ page }) => {
        await page.route('**/mentions/search', async (route) => {
            const { query } = route.request().postDataJSON();

            if (query === 'A') await new Promise((resolve) => setTimeout(resolve, 500));

            await route.fulfill({ json: mentionResponse([`Result for ${query}`]) }).catch(() => {});
        });
        await mountEditor(page, options);
        await textbox(page).click();
        await page.keyboard.type('@A');
        await page.waitForTimeout(250);
        await page.keyboard.type('l');
        await expect(page.getByRole('option', { name: 'Result for Al' })).toBeVisible();
        await page.waitForTimeout(500);
        await expect(page.getByRole('option')).toHaveCount(1);
    });

    test('says in plain words when people can’t be loaded, and can try again', async ({ page }) => {
        let fail = true;

        await page.route('**/mentions/search', (route) => (fail
            ? route.fulfill({ status: 500, contentType: 'text/html', body: '<h1>Stack trace</h1>' })
            : route.fulfill({ json: mentionResponse(['Alice']) })));
        await mountEditor(page, options);
        await textbox(page).click();
        await page.keyboard.type('@Al');

        const menu = page.locator('.verbb-editor__suggestions');

        await expect(menu).toContainText('Couldn’t load people');
        await expect(menu).toContainText('Keep typing and it’ll post as plain text.');
        await expect(menu).not.toContainText('Stack');
        fail = false;
        await menu.getByRole('button', { name: 'Try again' }).click();
        await expect(page.getByRole('option', { name: 'Alice' })).toBeVisible();
        await expect(textbox(page)).toBeFocused();
    });

    test('logs a missing token for the developer and shows the author the plain message', async ({ page }) => {
        const errors: string[] = [];

        page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
        });
        await mountEditor(page, { ...options, craft: { context: 'x', endpoints: craft.endpoints } });
        await textbox(page).click();
        await page.keyboard.type('@Al');
        await expect(page.locator('.verbb-editor__suggestions')).toContainText('Couldn’t load people');
        expect(errors.join('\n')).toContain('CSRF token');
    });
});

test.describe('uploads', () => {
    const options = {
        craft: { ...craft, uploads: { imageExtensions: ['png'], attachmentExtensions: ['txt'], maxFileSize: 1000 } },
        features: { image: true, attachment: true },
    };

    async function pickFiles(page: import('@playwright/test').Page, files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<void> {
        const chooser = page.waitForEvent('filechooser');

        await page.getByRole('button', { name: /Attach files|Add photos/ }).click();
        await (await chooser).setFiles(files);
    }

    const tray = (page: import('@playwright/test').Page) => page.locator('.verbb-editor__tray');
    const notice = (page: import('@playwright/test').Page) => page.locator('.verbb-editor__notice');

    test('uploads with the token, context and scope into the tray, and submits a reference', async ({ page }) => {
        let body = '';

        await page.route('**/assets/upload', async (route) => {
            body = route.request().postData() ?? '';
            await route.fulfill({ json: { asset: { id: 42, filename: 'photo.png', kind: 'inlineImage', url: null, temporary: true } } });
        });
        await mountEditor(page, { ...options, content: [text('Words')] });
        await pickFiles(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: PNG }]);
        await expect(tray(page).getByRole('button', { name: 'Add alt text for photo.png' })).toBeVisible();

        expect(body).toContain('name="CRAFT_CSRF_TOKEN"');
        expect(body).toContain('sample.reply');
        expect(body).toContain('{"ownerId":7}');
        await expect(page.locator('.ProseMirror img')).toHaveCount(0);
        await expect(tray(page).locator('img')).toHaveAttribute('src', /^blob:/);
        expect(await json(page)).toEqual([text('Words'), { type: 'editorAsset', attrs: { id: 42, alt: '', title: 'photo.png' } }]);
        expect(await page.evaluate(() => (window as any).editor.getHTML())).not.toContain('blob:');
    });

    test('offers only the allowed file types from one Attach control', async ({ page }) => {
        await mountEditor(page, options);

        const accept = page.evaluate(() => new Promise((resolve) => {
            const click = HTMLInputElement.prototype.click;

            HTMLInputElement.prototype.click = function() {
                HTMLInputElement.prototype.click = click;
                resolve(this.accept);
            };
        }));

        await page.getByRole('button', { name: 'Attach files' }).click();
        expect(await accept).toBe('.png,.txt');
    });

    test('shows progress, blocks submission while an upload is in flight and reports state', async ({ page }) => {
        let finish: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            finish = resolve;
        });

        await page.route('**/assets/upload', async (route) => {
            await gate;
            await route.fulfill({ json: { asset: { id: 42, filename: 'notes.txt', kind: 'attachment', url: null, size: 5 } } });
        });
        await openPage(page, '<form><verbb-editor name="body" submit-label="Post"></verbb-editor></form>');
        await page.evaluate((elementOptions) => {
            const element = document.querySelector('verbb-editor')!;

            (window as any).states = [];
            element.addEventListener('editor-upload-state', ((event: CustomEvent) => (window as any).states.push(event.detail.uploading)) as EventListener);
            element.options = elementOptions;
        }, options);
        await pickFiles(page, [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') }]);
        await expect(tray(page).locator('.verbb-editor__bar')).toHaveCount(1);
        await expect(page.locator('.verbb-editor__status')).toContainText('Uploading…');

        const during = await page.evaluate(() => ({
            uploading: document.querySelector('verbb-editor')!.editor!.isUploading(),
            valid: document.querySelector('form')!.checkValidity(),
            message: document.querySelector('verbb-editor')!.validationMessage,
        }));

        expect(during).toEqual({ uploading: true, valid: false, message: 'Please wait for your uploads to finish.' });

        finish();
        await expect(tray(page)).toContainText('notes.txt');
        await expect(tray(page)).toContainText('TXT');
        expect(await page.evaluate(() => document.querySelector('form')!.checkValidity())).toBe(true);
        expect(await page.evaluate(() => (window as any).states)).toEqual([true, false]);
    });

    test('keeps an upload that finishes after the editor went read-only', async ({ page }) => {
        let finish: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            finish = resolve;
        });

        await page.route('**/assets/upload', async (route) => {
            await gate;
            await route.fulfill({ json: { asset: { id: 42, filename: 'notes.txt', kind: 'attachment', url: null } } });
        });
        await mountEditor(page, options);
        await pickFiles(page, [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') }]);
        await page.evaluate(() => (window as any).editor.setEditable(false));
        finish();
        await expect.poll(() => json(page)).toEqual([{ type: 'attachment', attrs: { id: 42 } }]);
        await expect(tray(page)).toContainText('notes.txt');
    });

    test('shows the server’s refusal, holds the form, and retries', async ({ page }) => {
        let attempts = 0;

        await page.route('**/assets/upload', async (route) => {
            attempts++;

            if (attempts === 1) {
                await route.fulfill({ status: 400, json: { message: 'File exceeds the maximum allowed size.' } });
            } else {
                await route.fulfill({ json: { asset: { id: 42, filename: 'photo.png', kind: 'inlineImage', url: '/photo.png' } } });
            }
        });
        await openPage(page, '<form><verbb-editor name="body"></verbb-editor></form>');
        await page.evaluate((elementOptions) => {
            document.querySelector('verbb-editor')!.options = elementOptions;
        }, options);
        await pickFiles(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: PNG }]);
        await expect(notice(page)).toContainText('photo.png didn’t upload. File exceeds the maximum allowed size.');
        expect(await page.evaluate(() => document.querySelector('verbb-editor')!.validationMessage)).toBe('Retry or remove the upload that didn’t finish.');
        await page.getByRole('button', { name: 'Retry upload of photo.png' }).click();
        await expect(tray(page).locator('img')).toHaveAttribute('src', '/photo.png');
        await expect(notice(page)).toBeEmpty();
    });

    test('refuses a file over the size or count limit, or of a refused type, before uploading', async ({ page }) => {
        let uploads = 0;

        await page.route('**/assets/upload', async (route) => {
            uploads++;
            await route.fulfill({ json: { asset: { id: 40 + uploads, filename: 'a.png', kind: 'inlineImage', url: '/a.png' } } });
        });
        await mountEditor(page, { ...options, craft: { ...options.craft, uploads: { ...options.craft.uploads, maxImages: 1 } } });
        await pickFiles(page, [{ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(2000) }]);
        await expect(notice(page)).toContainText('large.png is larger than the upload limit.');
        await pickFiles(page, [{ name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') }]);
        await expect(notice(page)).toContainText('virus.exe can’t be added here.');
        expect(uploads).toBe(0);

        await pickFiles(page, [{ name: 'a.png', mimeType: 'image/png', buffer: PNG }, { name: 'b.png', mimeType: 'image/png', buffer: PNG }]);
        await expect(notice(page)).toContainText('You can add up to 1 photo.');
        await expect(tray(page).locator('img')).toHaveCount(1);
        expect(uploads).toBe(1);
    });

    test('edits alt text in the tray without submitting the host form', async ({ page }) => {
        await mountEditor(page, { features: { image: true }, content: [{ type: 'editorAsset', attrs: { id: 9, src: '/photo.png', alt: 'Old' } }] }, '<form><div id="editor"></div><button>Send</button></form>');
        await page.evaluate(() => {
            (window as any).submits = 0;
            document.querySelector('form')!.addEventListener('submit', (event) => {
                event.preventDefault();
                (window as any).submits++;
            });
        });
        await tray(page).getByRole('button', { name: 'Edit alt text for Old' }).click();
        await page.getByRole('textbox', { name: 'Alt text', exact: true }).fill('New alt');
        await page.keyboard.press('Enter');
        await expectNoSubmit(page);
        expect(await json(page)).toEqual([{ type: 'editorAsset', attrs: { id: 9, alt: 'New alt' } }]);
        await expect(tray(page).getByRole('button', { name: 'Edit alt text for New alt' })).toBeVisible();
    });

    test('pasting Office-style content keeps its text', async ({ page }) => {
        let uploads = 0;

        await page.route('**/assets/upload', async (route) => {
            uploads++;
            await route.abort();
        });
        await mountEditor(page, options);
        await textbox(page).click();
        await page.evaluate((png) => {
            const data = new DataTransfer();

            data.setData('text/html', '<p>Spreadsheet text</p>');
            data.setData('text/plain', 'Spreadsheet text');
            data.items.add(new File([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], 'image.png', { type: 'image/png' }));
            document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        }, PNG.toString('base64'));
        await expect(textbox(page)).toContainText('Spreadsheet text');
        expect(uploads).toBe(0);
    });

    test('pasting only an image uploads it to the tray', async ({ page }) => {
        await page.route('**/assets/upload', (route) => route.fulfill({ json: { asset: { id: 42, filename: 'image.png', kind: 'inlineImage', url: '/image.png' } } }));
        await mountEditor(page, options);
        await textbox(page).click();
        await page.evaluate((png) => {
            const data = new DataTransfer();

            data.items.add(new File([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], 'image.png', { type: 'image/png' }));
            document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        }, PNG.toString('base64'));
        await expect(tray(page).locator('img')).toHaveAttribute('src', '/image.png');
    });

    test('the whole editor is the drop target', async ({ page }) => {
        await page.route('**/assets/upload', (route) => route.fulfill({ json: { asset: { id: 42, filename: 'notes.txt', kind: 'attachment', url: null } } }));
        await mountEditor(page, options);

        const shown = await page.evaluate(() => {
            const data = new DataTransfer();
            const root = document.querySelector<HTMLElement>('.verbb-editor')!;
            const footer = document.querySelector('.verbb-editor__foot')!;

            data.items.add(new File(['notes'], 'notes.txt', { type: 'text/plain' }));
            footer.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true, cancelable: true }));

            const overlay = getComputedStyle(root.querySelector('.verbb-editor__drop')!).display;

            footer.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));

            return { overlay, after: root.classList.contains('is-dropping') };
        });

        expect(shown).toEqual({ overlay: 'grid', after: false });
        await expect(tray(page)).toContainText('notes.txt');
    });

    test('a dropped file the editor can’t take doesn’t navigate away', async ({ page }) => {
        await mountEditor(page, { features: { bold: true } });

        const prevented = await page.evaluate(() => {
            const data = new DataTransfer();

            data.items.add(new File(['x'], 'notes.txt', { type: 'text/plain' }));

            const event = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });

            document.querySelector('.ProseMirror')!.dispatchEvent(event);

            return event.defaultPrevented;
        });

        expect(prevented).toBe(true);
        await expect(notice(page)).toContainText('notes.txt can’t be added here.');
    });
});

test.describe('appearance', () => {
    test('keeps lists and headings visible under a host reset', async ({ page }) => {
        await mountEditor(page, {
            features: { headings: [2] },
            content: [
                { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
                { type: 'bulletList', content: [{ type: 'listItem', content: [text('One')] }] },
                text('Body'),
            ],
        });
        await page.addStyleTag({ content: 'ul, ol { list-style: none; padding: 0; margin: 0 } h1, h2, h3 { font-size: inherit; font-weight: inherit; margin: 0 }' });

        const styles = await page.evaluate(() => ({
            marker: getComputedStyle(document.querySelector('.ProseMirror ul')!).listStyleType,
            heading: parseFloat(getComputedStyle(document.querySelector('.ProseMirror h2')!).fontSize),
            body: parseFloat(getComputedStyle(document.querySelector('.ProseMirror p')!).fontSize),
        }));

        expect(styles.marker).toBe('disc');
        expect(styles.heading).toBeGreaterThan(styles.body);
    });

    test('applies two themes side by side and changes without losing content', async ({ page }) => {
        await openPage(page, '<div id="a"></div><div id="b"></div>');

        const result = await page.evaluate(async () => {
            const { VerbbEditor } = window as any;
            const content = [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }];
            const light = await VerbbEditor.Editor.create('#a', { theme: 'light', content });
            const dark = await VerbbEditor.Editor.create('#b', { theme: 'dark', content });
            const scheme = (selector: string) => getComputedStyle(document.querySelector(`${selector} .verbb-editor`)!).colorScheme;
            const before = [scheme('#a'), scheme('#b')];

            light.setTheme('dark');

            return { before, after: scheme('#a'), text: light.getText() };
        });

        expect(result).toEqual({ before: ['light', 'dark'], after: 'dark', text: 'Hi' });
    });

    test('the none theme gives floating menus their own surface', async ({ page }) => {
        await routeMentions(page, () => mentionResponse(['Alice']));
        await mountEditor(page, { theme: 'none', features: { mention: true }, craft });
        await textbox(page).click();
        await page.keyboard.type('@Al');
        await expect(page.getByRole('option', { name: 'Alice' })).toBeVisible();

        const background = await page.locator('.verbb-editor__suggestions').evaluate((element) => getComputedStyle(element).backgroundColor);

        expect(background).not.toBe('rgba(0, 0, 0, 0)');
    });

    test('fits a narrow screen without overflowing', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 640 });
        await mountEditor(page, { preset: 'full', content: [text('A'.repeat(200))] });

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

        expect(overflow).toBe(false);
    });

    test('the footer toolbar is one tab stop after the text, with arrow keys inside it', async ({ page }) => {
        await mountEditor(page, { preset: 'minimal' }, '<button id="before">Before</button><div id="editor"></div>');
        await page.locator('#before').focus();
        await page.keyboard.press('Tab');
        await expect(textbox(page)).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('[data-command="bold"]')).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('[data-command="italic"]')).toBeFocused();
        await page.keyboard.press('End');
        await expect(page.locator('[data-command="more"]')).toBeFocused();
    });

    test('shows a tooltip with the shortcut on hover and keyboard focus', async ({ page }) => {
        await mountEditor(page, { preset: 'minimal' });
        await page.locator('[data-command="bold"]').hover();

        const tip = page.getByRole('tooltip');

        await expect(tip).toBeVisible();
        await expect(tip).toContainText('Bold');
        await expect(tip.locator('kbd')).toHaveText(/(⌘B|Ctrl\+B)/);
    });

    test('More is a keyboard menu with undo, redo and formatting help', async ({ page }) => {
        await mountEditor(page, { preset: 'standard', content: [text('Hi')] });
        await textbox(page).click();
        await page.keyboard.type('!');
        await page.locator('[data-command="more"]').click();

        const menu = page.getByRole('menu', { name: 'More formatting' });

        await expect(menu.getByRole('menuitemcheckbox', { name: 'Strikethrough' })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitemcheckbox', { name: 'Inline code' })).toBeFocused();
        await menu.getByRole('menuitem', { name: 'Undo' }).click();
        await expect(textbox(page)).toHaveText('Hi');
        await page.locator('[data-command="more"]').click();
        await page.getByRole('menu').getByRole('menuitem', { name: 'Formatting help' }).click();

        const help = page.getByRole('dialog', { name: 'Formatting help' });

        await expect(help).toContainText('Markdown works too');
        await page.keyboard.press('Escape');
        await expect(help).toHaveCount(0);
        await expect(page.locator('[data-command="more"]')).toBeFocused();
    });

    test('marks the textbox read-only from the start', async ({ page }) => {
        await mountEditor(page, { editable: false });
        await expect(textbox(page)).toHaveAttribute('aria-readonly', 'true');
    });
});

test.describe('<verbb-editor>', () => {
    const form = (attributes = '', inner = '') => `<form id="f"><verbb-editor name="body" ${attributes}>${inner}</verbb-editor></form>`;

    async function trackSubmits(page: import('@playwright/test').Page): Promise<void> {
        await page.evaluate(() => {
            (window as any).submits = 0;
            document.querySelector('form')!.addEventListener('submit', (event) => {
                event.preventDefault();
                (window as any).submits++;
            });
        });
    }

    const submits = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).submits as number);

    test('posts with ⌘↵ or its Post button, and holds an empty post', async ({ page }) => {
        await openPage(page, form('submit-label="Reply"', '<span slot="header">Replying to <b>Alex</b></span>'));
        await trackSubmits(page);
        await expect(page.locator('.verbb-editor__head')).toHaveText('Replying to Alex');

        const post = page.getByRole('button', { name: 'Reply' });

        await expect(post).toHaveAttribute('aria-disabled', 'true');
        // A held button stays pressable, so it can say why; Playwright treats aria-disabled as disabled.
        await post.click({ force: true });
        expect(await submits(page)).toBe(0);
        await expect(page.locator('.verbb-editor .verbb-editor__sr[role="status"]')).toHaveText('Write something first.');

        await textbox(page).click();
        await page.keyboard.type('Thanks');
        await page.keyboard.press('ControlOrMeta+Enter');
        expect(await submits(page)).toBe(1);
        await post.click();
        expect(await submits(page)).toBe(2);
    });

    test('holds a post over the limit, natively too', async ({ page }) => {
        await openPage(page, form('limit="10"', '<button slot="actions" type="submit">Send</button>'));
        await trackSubmits(page);
        await textbox(page).click();
        await page.keyboard.type('Eight ch');
        await expect(page.locator('.verbb-editor__count')).toContainText('2');
        await page.keyboard.type('aracters');
        await expect(page.locator('.verbb-editor__count')).toContainText('-6');
        expect(await page.evaluate(() => document.querySelector('verbb-editor')!.validationMessage)).toBe('Too long by 6 characters');
        await page.getByRole('button', { name: 'Send' }).click();
        expect(await submits(page)).toBe(0);
        await page.keyboard.press('Backspace');
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('Short');
        await page.getByRole('button', { name: 'Send' }).click();
        expect(await submits(page)).toBe(1);
    });

    test('Enter sends for messaging, but not while choosing a mention or in a list', async ({ page }) => {
        await routeMentions(page, () => mentionResponse(['Alice']));
        await openPage(page, form('enter-submits submit-label="Send"'));
        await page.evaluate((craftOptions) => {
            document.querySelector('verbb-editor')!.options = { preset: 'standard', craft: craftOptions, features: { mention: true } };
        }, craft);
        await trackSubmits(page);
        await textbox(page).click();
        await page.keyboard.type('Hi @Al');
        await expect(page.getByRole('option', { name: 'Alice' })).toBeVisible();
        await page.keyboard.press('Enter');
        expect(await submits(page)).toBe(0);
        await page.keyboard.press('ControlOrMeta+Shift+8');
        await page.keyboard.type('item');
        await page.keyboard.press('Enter');
        expect(await submits(page)).toBe(0);
        // An empty item leaves the list, and only then does Enter send.
        await page.keyboard.press('Enter');
        expect(await submits(page)).toBe(0);
        await page.keyboard.press('Enter');
        expect(await submits(page)).toBe(1);
    });

    test('shows a post failure with Try again, and goes read-only while busy', async ({ page }) => {
        await openPage(page, form('submit-label="Post"'));
        await page.evaluate(() => {
            const element = document.querySelector('verbb-editor')!;

            element.addEventListener('editor-submit', (event) => {
                event.preventDefault();
                element.setAttribute('busy', '');
                setTimeout(() => {
                    element.removeAttribute('busy');
                    element.showPostError();
                }, 100);
            });
        });
        await textbox(page).click();
        await page.keyboard.type('Hello');
        await page.getByRole('button', { name: 'Post' }).click();
        await expect(page.locator('.verbb-editor__submit')).toContainText('Posting…');
        await expect(textbox(page)).toHaveAttribute('contenteditable', 'false');
        await expect(page.locator('.verbb-editor__notice')).toContainText('Couldn’t post.');
        await expect(textbox(page)).toHaveText('Hello');
        await page.getByRole('button', { name: 'Try again' }).click();
        await expect(page.locator('.verbb-editor__submit')).toContainText('Posting…');
    });

    test('restores a draft after a reload, with Discard', async ({ page }) => {
        await openPage(page, form('draft-key="reply:7"'));
        await textbox(page).click();
        await page.keyboard.type('Unfinished thought');
        await expect(page.locator('.verbb-editor__status')).toContainText('Draft saved');

        await openPage(page, form('draft-key="reply:7"'));
        await expect(textbox(page)).toHaveText('Unfinished thought');
        await expect(page.locator('.verbb-editor__notice')).toContainText('Restored your draft from');
        expect(await page.evaluate(() => new FormData(document.querySelector('form')!).get('body'))).toContain('Unfinished thought');

        await page.getByRole('button', { name: 'Discard' }).click();
        await expect(textbox(page)).toHaveText('');
        expect(await page.evaluate(() => localStorage.getItem('verbb-editor-draft:reply:7'))).toBeNull();
    });

    test('collapses to one line and opens on focus', async ({ page }) => {
        await openPage(page, '<verbb-editor collapsible placeholder="Add to the conversation…"></verbb-editor><button id="away">Away</button>');

        const root = page.locator('.verbb-editor');

        await expect(root).toHaveClass(/is-collapsed/);
        await expect(page.locator('.verbb-editor__foot')).toBeHidden();
        await textbox(page).click();
        await expect(root).not.toHaveClass(/is-collapsed/);
        await expect(page.locator('.verbb-editor__foot')).toBeVisible();
        await page.locator('#away').click();
        await expect(root).toHaveClass(/is-collapsed/);
    });

    test('a host focusing a collapsed editor opens it before the next frame, not a frame later', async ({ page }) => {
        await openPage(page, '');

        // As Comments swaps Editor in for a focused plain box: load its features, add the element, then
        // focus it at once.
        const collapsedFrames = await page.evaluate(async () => {
            await (window as unknown as { VerbbEditor: { loadFeatures(options: object): Promise<void> } }).VerbbEditor.loadFeatures({});

            const element = document.createElement('verbb-editor');
            let frames = 0;

            element.toggleAttribute('collapsible', true);
            document.body.append(element);
            element.focus();

            for (let frame = 0; frame < 3; frame++) {
                await new Promise(requestAnimationFrame);
                if (element.querySelector('.verbb-editor')!.classList.contains('is-collapsed')) frames++;
            }

            return frames;
        });

        expect(collapsedFrames).toBe(0);
        await expect(textbox(page)).toBeFocused();
    });

    test('stays open for a press inside it, a window switch or a filled-in field, and collapses for a press outside', async ({ page }) => {
        await openPage(page, '<verbb-editor collapsible placeholder="Add to the conversation…"><div slot="footer"><p id="hint">Out of five.</p><input id="rating" aria-label="Rating" value=""></div></verbb-editor><p id="outside">Elsewhere on the page.</p>');

        const root = page.locator('.verbb-editor');

        await textbox(page).click();
        await expect(root).not.toHaveClass(/is-collapsed/);

        // Text that takes no focus, such as a field's instructions.
        await page.locator('#hint').click();
        await page.waitForTimeout(300);
        await expect(root).not.toHaveClass(/is-collapsed/);

        // Focus that leaves for nowhere, as when another window or a password manager takes it.
        await textbox(page).click();
        await page.evaluate(() => (document.activeElement as HTMLElement).blur());
        await page.waitForTimeout(300);
        await expect(root).not.toHaveClass(/is-collapsed/);

        // A field someone has filled in keeps it open, as collapsing would hide it.
        await page.locator('#rating').fill('4');
        await page.locator('#outside').click();
        await page.waitForTimeout(300);
        await expect(root).not.toHaveClass(/is-collapsed/);

        await page.locator('#rating').fill('');
        await page.locator('#outside').click();
        await expect(root).toHaveClass(/is-collapsed/);
    });

    test('adapts to its own width: tools scroll and Post becomes an arrow', async ({ page }) => {
        await openPage(page, '<div style="width:360px"><verbb-editor submit-label="Reply" preset="full"></verbb-editor></div><div style="width:900px"><verbb-editor submit-label="Reply" preset="full"></verbb-editor></div>');

        const styles = await page.evaluate(() => [...document.querySelectorAll('verbb-editor')].map((element) => ({
            label: getComputedStyle(element.querySelector('.verbb-editor__submit-label')!).display,
            icon: getComputedStyle(element.querySelector('.verbb-editor__submit > .verbb-editor__icon')!).display,
            overflow: getComputedStyle(element.querySelector('.verbb-editor__toolbar')!).overflowX,
            wraps: element.querySelector('.verbb-editor__foot')!.getBoundingClientRect().height > 60,
        })));

        expect(styles).toEqual([
            { label: 'none', icon: 'block', overflow: 'auto', wraps: false },
            { label: 'block', icon: 'none', overflow: 'visible', wraps: false },
        ]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    });

    test('takes the host’s tokens, and the Control Panel’s colours in the craft theme', async ({ page }) => {
        await openPage(page, `
            <div style="--verbb-editor-accent: rgb(14, 124, 134)"><verbb-editor id="host" submit-label="Post"></verbb-editor></div>
            <div style="--link-color: rgb(11, 105, 163); --white: rgb(255, 255, 255)"><verbb-editor id="cp" theme="craft" submit-label="Post"></verbb-editor></div>
            <div style="background: rgb(23, 25, 29); color: rgb(232, 234, 237)"><verbb-editor id="dark" theme="dark"></verbb-editor></div>`);

        const colours = await page.evaluate(() => ({
            host: getComputedStyle(document.querySelector('#host .verbb-editor__submit')!).backgroundColor,
            cp: getComputedStyle(document.querySelector('#cp .verbb-editor__submit')!).backgroundColor,
            darkSurface: getComputedStyle(document.querySelector('#dark .verbb-editor')!).backgroundColor,
            darkText: getComputedStyle(document.querySelector('#dark .verbb-editor')!).color,
        }));

        expect(colours).toEqual({ host: 'rgb(14, 124, 134)', cp: 'rgb(11, 105, 163)', darkSurface: 'rgba(0, 0, 0, 0)', darkText: 'rgb(232, 234, 237)' });
    });

    test('gives avatars token colours, which the craft theme takes from the Control Panel palette', async ({ page }) => {
        await routeMentions(page, () => mentionResponse(['Alice Able', 'Bob Baker']));
        await openPage(page, `<div style="--violet-600: rgb(1, 2, 3); --orange-700: rgb(4, 5, 6); --green-700: rgb(7, 8, 9); --white: rgb(250, 250, 250)"><verbb-editor theme="craft"></verbb-editor></div>`);
        await page.evaluate((craftOptions) => {
            document.querySelector('verbb-editor')!.options = { craft: craftOptions, features: { mention: true } };
        }, craft);
        await textbox(page).click();
        await page.keyboard.type('@Al');
        await expect(page.getByRole('option', { name: 'Bob Baker' })).toBeVisible();

        const avatars = await page.locator('.verbb-editor__avatar').evaluateAll((badges) => badges.map((badge) => ({
            colour: (badge as HTMLElement).dataset.colour,
            background: getComputedStyle(badge).backgroundColor,
            text: getComputedStyle(badge).color,
        })));

        // IDs 1 and 2 pick the second and third colours, so the first token isn't the only one checked.
        expect(avatars).toEqual([
            { colour: '2', background: 'rgb(4, 5, 6)', text: 'rgb(250, 250, 250)' },
            { colour: '3', background: 'rgb(7, 8, 9)', text: 'rgb(250, 250, 250)' },
        ]);
    });

    test('the editor input has no frame and still joins the form', async ({ page }) => {
        await openPage(page, '<form><verbb-editor-input name="body" required></verbb-editor-input></form>');
        await textbox(page).click();
        await page.keyboard.type('Hello');
        expect(await page.evaluate(() => new FormData(document.querySelector('form')!).get('body'))).toContain('Hello');
        await expect(page.locator('.verbb-editor__submit, .verbb-editor__head')).toHaveCount(0);
        await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
    });
});

test.describe('accessibility, touch and right to left', () => {
    const mentionOptions = JSON.stringify({ features: { mention: true, image: true, attachment: true }, craft: { ...craft, uploads: { imageExtensions: ['png'] } } });
    const live = (page: import('@playwright/test').Page) => page.locator('.verbb-editor > .verbb-editor__sr[role="status"]');

    // WCAG relative luminance contrast between two computed `rgb()` colours.
    const contrast = (page: import('@playwright/test').Page, selector: string, colour: string, background: string) => page.evaluate(({ selector, colour, background }) => {
        const root = document.querySelector<HTMLElement>(selector)!;
        const resolve = (value: string) => {
            const probe = document.createElement('i');

            probe.style.color = value;
            root.append(probe);

            const computed = getComputedStyle(probe).color;
            // `color-mix()` resolves to `color(srgb r g b / a)` with 0–1 channels, other colours to `rgb()`.
            const scale = computed.startsWith('color(') ? 255 : 1;
            const [r, g, b, alpha = 1] = computed.match(/[\d.]+/g)!.map(Number).map((value, index) => (index < 3 ? value * scale : value));

            probe.remove();

            // A translucent surface, such as the file card's, sits on the white editor.
            return [r, g, b].map((channel) => (channel * alpha + 255 * (1 - alpha)) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        };
        const luminance = (value: string) => {
            const [r, g, b] = resolve(value);

            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const [light, dark] = [luminance(colour), luminance(background)].sort((a, b) => b - a);

        return (light + 0.05) / (dark + 0.05);
    }, { selector, colour, background });

    test('keeps keyboard focus on Post while the host posts, and names and announces it', async ({ page }) => {
        await openPage(page, '<form><verbb-editor name="body" submit-label="Reply"></verbb-editor></form>');
        await page.evaluate(() => {
            const element = document.querySelector('verbb-editor')!;

            element.addEventListener('editor-submit', (event) => {
                event.preventDefault();
                element.setAttribute('busy', '');
                (window as any).finish = () => element.removeAttribute('busy');
            });
        });
        await textbox(page).click();
        await page.keyboard.type('Hello');

        const post = page.locator('.verbb-editor__submit');

        await post.focus();
        await page.keyboard.press('Enter');
        await expect(post).toBeFocused();
        await expect(page.getByRole('button', { name: 'Posting…' })).toBeFocused();
        await expect(live(page)).toHaveText('Posting…');

        await page.evaluate(() => (window as any).finish());
        await expect(page.getByRole('button', { name: 'Reply' })).toBeFocused();
    });

    test('tabbing out of a popover closes it and carries on from its trigger', async ({ page }) => {
        await openPage(page, '<form><verbb-editor name="body" submit-label="Reply"><button slot="actions" type="reset">Cancel</button></verbb-editor></form>');
        await textbox(page).click();
        await page.keyboard.type('Hello');

        await page.locator('[data-command="more"]').focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('menu')).toBeVisible();
        await page.keyboard.press('Tab');
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();

        await page.locator('[data-command="link"]').focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('combobox', { name: 'Link address or page' })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('.verbb-editor__pop')).toHaveCount(0);
        await expect(page.locator('[data-command="link"]')).toBeFocused();

        await page.locator('[data-command="more"]').focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Shift+Tab');
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(page.locator('[data-command="more"]')).toBeFocused();
    });

    test('Escape closes a popover or the mention list without reaching the host', async ({ page }) => {
        await page.route('**/mentions/search', (route) => route.fulfill({ json: mentionResponse(['Ann Lee']) }));
        await openPage(page, `<form><verbb-editor name="body" data-options='${mentionOptions}'></verbb-editor></form>`);
        await page.evaluate(() => {
            (window as any).escapes = 0;
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') (window as any).escapes++;
            });
        });
        await textbox(page).click();
        await page.keyboard.type('Hi');

        await page.locator('[data-command="more"]').click();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toHaveCount(0);

        await textbox(page).click();
        await page.keyboard.press('ControlOrMeta+k');
        await expect(page.getByRole('combobox')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('combobox')).toHaveCount(0);

        await textbox(page).click();
        await page.keyboard.type(' @');
        await expect(page.getByRole('listbox', { name: 'Mention suggestions' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('listbox', { name: 'Mention suggestions' })).toHaveCount(0);

        expect(await page.evaluate(() => (window as any).escapes)).toBe(0);
    });

    test('a tooltip can be hovered and dismissed with Escape', async ({ page }) => {
        await mountEditor(page, { preset: 'minimal' });

        const tip = page.getByRole('tooltip');

        await page.locator('[data-command="bold"]').hover();
        await expect(tip).toBeVisible();

        const box = (await tip.boundingBox())!;

        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
        await page.waitForTimeout(300);
        await expect(tip).toBeVisible();

        await page.locator('[data-command="italic"]').focus();
        await expect(tip).toContainText('Italic');
        await page.keyboard.press('Escape');
        await expect(tip).toBeHidden();
    });

    test('the placeholder is announced as a placeholder, not as text', async ({ page }) => {
        await openPage(page, '<verbb-editor aria-label="Reply" placeholder="Write a reply…"></verbb-editor>');
        await expect(textbox(page)).toHaveAttribute('aria-placeholder', 'Write a reply…');
        expect(await textbox(page).ariaSnapshot()).not.toContain('Write a reply…');

        await page.locator('verbb-editor').evaluate((element) => element.setAttribute('placeholder', 'Say something…'));
        await expect(textbox(page)).toHaveAttribute('aria-placeholder', 'Say something…');
    });

    test('announces reaching and passing the limit once, and marks the text invalid while it’s over', async ({ page }) => {
        await openPage(page, '<form><verbb-editor name="body" limit="20" submit-label="Reply"></verbb-editor></form>');
        await textbox(page).click();
        await page.keyboard.insertText('a'.repeat(17));
        await page.keyboard.type('a');
        await expect(live(page)).toHaveText('2 characters left');
        await page.keyboard.type('a');
        // Counting down within the last stretch isn't announced on every key.
        await page.waitForTimeout(100);
        await expect(live(page)).toHaveText('2 characters left');
        await page.keyboard.type('aa');
        await expect(live(page)).toHaveText('Too long by 1 character');
        await expect(textbox(page)).toHaveAttribute('aria-invalid', 'true');
        await page.keyboard.press('Backspace');
        await expect(textbox(page)).not.toHaveAttribute('aria-invalid');
    });

    test('a restored draft that ends in a mention doesn’t open the list until the author is back', async ({ page }) => {
        await page.route('**/mentions/search', (route) => route.fulfill({ json: mentionResponse(['Ann Lee']) }));
        await page.goto('/');
        await page.evaluate(() => localStorage.setItem('verbb-editor-draft:m', JSON.stringify({ version: 1, savedAt: Date.now() - 60000, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thanks @an' }] }], uploadTimes: {} })));
        await openPage(page, `<form><verbb-editor name="body" draft-key="m" data-options='${mentionOptions}'></verbb-editor></form>`);
        await expect(textbox(page)).toHaveText('Thanks @an');
        await page.waitForTimeout(300);
        await expect(page.locator('.verbb-editor__suggestions')).toHaveCount(0);
        await expect(textbox(page)).not.toHaveAttribute('aria-controls');

        await textbox(page).click();
        await page.keyboard.press('End');
        await page.keyboard.type('n');
        await expect(page.getByRole('listbox', { name: 'Mention suggestions' })).toBeVisible();
    });

    test('in a right-to-left layout, arrows follow the bar, shortcuts read left to right and popovers line up with the start', async ({ page }) => {
        await openPage(page, '<form dir="rtl"><verbb-editor name="body" reply-to="أحمد" submit-label="إرسال"></verbb-editor></form>');
        await page.locator('[data-command="bold"]').focus();
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('[data-command="italic"]')).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('[data-command="bold"]')).toBeFocused();

        const layout = await page.evaluate(() => {
            const reply = getComputedStyle(document.querySelector('.verbb-editor__reply')!);

            return {
                kbd: getComputedStyle(document.querySelector('.verbb-editor__submit kbd')!).direction,
                replyPadding: [reply.paddingRight, reply.paddingLeft],
                replyIcon: getComputedStyle(document.querySelector('.verbb-editor__reply > .verbb-editor__icon')!).transform,
                sendIcon: getComputedStyle(document.querySelector('.verbb-editor__submit > .verbb-editor__icon')!).transform,
            };
        });

        expect(layout).toEqual({ kbd: 'ltr', replyPadding: ['9px', '4px'], replyIcon: 'matrix(-1, 0, 0, 1, 0, 0)', sendIcon: 'none' });

        await textbox(page).click();
        await page.keyboard.insertText('مرحبا بالعالم');
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('ControlOrMeta+k');

        const edges = await page.evaluate(() => {
            // The selected words start at their right edge in Arabic.
            const range = document.createRange();

            range.selectNodeContents(document.querySelector('.ProseMirror p')!);

            const popover = document.querySelector('.verbb-editor__pop--link')!.getBoundingClientRect();

            return { selection: Math.round(range.getBoundingClientRect().right), popover: Math.round(popover.right) };
        });

        expect(Math.abs(edges.selection - edges.popover)).toBeLessThan(6);
    });

    test('keeps a file’s size whole in right-to-left text', async ({ page }) => {
        await page.route('**/assets/upload', (route) => route.fulfill({ json: { asset: { id: 9, url: null, filename: 'notes.txt', kind: 'attachment', size: 2048, mimeType: 'text/plain' } } }));
        await openPage(page, `<form dir="rtl"><verbb-editor name="body" data-options='${JSON.stringify({ features: { attachment: true }, craft: { ...craft, uploads: { attachmentExtensions: ['txt'] } } })}'></verbb-editor></form>`);

        const chooser = page.waitForEvent('filechooser');

        await page.getByRole('button', { name: 'Attach files' }).click();
        await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x'.repeat(2048)) });
        await expect(page.locator('.verbb-editor__file-text bdi')).toHaveText(['2 KB', 'TXT']);
    });

    test('draws focus, popover edges, pressed tools and the chosen option in forced colours', async ({ page }) => {
        await page.emulateMedia({ forcedColors: 'active' });
        await mountEditor(page, { preset: 'standard', content: [text('Hi')] });
        await textbox(page).click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('ControlOrMeta+b');
        await page.locator('[data-command="more"]').focus();
        await page.keyboard.press('Enter');

        const styles = await page.evaluate(() => ({
            focus: getComputedStyle(document.querySelector('.verbb-editor')!).outlineStyle,
            popover: getComputedStyle(document.querySelector('.verbb-editor__pop')!).borderTopStyle,
            pressed: getComputedStyle(document.querySelector('[data-command="bold"]')!).forcedColorAdjust,
            option: getComputedStyle(document.querySelector('.verbb-editor__menu [role^="menuitem"]')!).outlineStyle,
        }));

        expect(styles).toEqual({ focus: 'solid', popover: 'solid', pressed: 'none', option: 'solid' });
    });

    test('muted text and the placeholder meet AA contrast on every light surface', async ({ page }) => {
        await openPage(page, '<verbb-editor placeholder="Write…"></verbb-editor>');

        const placeholder = await page.evaluate(() => getComputedStyle(document.querySelector('.ProseMirror p')!, '::before').color);
        const muted = await page.evaluate(() => {
            const probe = document.createElement('i');

            probe.style.color = 'var(--_muted)';
            document.querySelector('.verbb-editor')!.append(probe);

            return getComputedStyle(probe).color;
        });

        expect(placeholder).toBe(muted);

        for (const surface of ['var(--_bg)', 'var(--_pop-bg)', 'var(--_soft)', 'var(--_hover)']) {
            expect(await contrast(page, '.verbb-editor', 'var(--_muted)', surface)).toBeGreaterThanOrEqual(4.5);
        }

        expect(await contrast(page, '.verbb-editor', 'var(--_accent)', 'var(--_soft)')).toBeGreaterThanOrEqual(4.5);
    });

    test('a very narrow editor wraps its status and actions rather than hiding the tools', async ({ page }) => {
        await openPage(page, '<div style="width:220px"><form><verbb-editor name="body" submit-label="Reply" limit="10"><button slot="actions" type="reset" class="verbb-editor__button">Cancel</button></verbb-editor></form></div>');
        await textbox(page).click();
        await page.keyboard.type('123456789');

        const layout = await page.evaluate(() => ({
            toolbar: document.querySelector('.verbb-editor__toolbar')!.clientWidth,
            actionsBelow: document.querySelector('.verbb-editor__actions')!.getBoundingClientRect().top > document.querySelector('.verbb-editor__toolbar')!.getBoundingClientRect().bottom - 1,
        }));

        expect(layout.toolbar).toBeGreaterThanOrEqual(72);
        expect(layout.actionsBelow).toBe(true);
    });

    test('a held Post doesn’t shake when motion is reduced', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openPage(page, '<form><verbb-editor name="body" submit-label="Reply"></verbb-editor></form>');
        await page.locator('.verbb-editor__submit').click({ force: true });
        await expect(live(page)).toHaveText('Write something first.');
        expect(await page.locator('.verbb-editor__submit').evaluate((button) => button.getAnimations().length)).toBe(0);
    });

    test('a faded "Draft saved" keeps its words at full contrast and fades only the check mark', async ({ page }) => {
        await openPage(page, '<form><verbb-editor name="body" draft-key="fade"></verbb-editor></form>');
        await textbox(page).click();
        await page.keyboard.type('Unfinished');
        await expect(page.locator('.verbb-editor__status')).toHaveClass(/is-faded/, { timeout: 6000 });

        const opacity = await page.evaluate(() => {
            const status = document.querySelector('.verbb-editor__status')!;

            return {
                status: getComputedStyle(status).opacity,
                text: getComputedStyle(status.querySelector('.verbb-editor__status-text')!).opacity,
                icon: getComputedStyle(status.querySelector('.verbb-editor__icon')!).opacity,
            };
        });

        expect(opacity).toEqual({ status: '1', text: '1', icon: '0.4' });
        expect(await contrast(page, '.verbb-editor', 'var(--_muted)', 'var(--_bg)')).toBeGreaterThanOrEqual(4.5);
    });

    test('every avatar colour carries white initials at 4.5:1, in the default and craft palettes', async ({ page }) => {
        // Craft 5's own palette values, as cp.css sets them on :root.
        const palette = '--white: #fff; --violet-600: #7c3aed; --orange-700: #c2410c; --green-700: #15803d; --blue-600: #2563eb; --pink-600: #db2777; --cyan-700: #0e7490; --amber-700: #b45309; --lime-700: #4d7c0f';

        await openPage(page, `<verbb-editor id="light"></verbb-editor><div style="${palette}"><verbb-editor id="cp" theme="craft"></verbb-editor></div>`);

        for (const id of ['light', 'cp']) {
            for (let colour = 1; colour <= 8; colour++) {
                expect(await contrast(page, `#${id} .verbb-editor`, 'var(--_avatar-fg)', `var(--_avatar-${colour})`), `${id} avatar ${colour}`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    test('the frame’s border reaches 3:1 against the editor in each theme', async ({ page }) => {
        await openPage(page, `<verbb-editor id="light"></verbb-editor>
            <div style="background: #16181d; color: #e6e8eb"><verbb-editor id="dark" theme="dark"></verbb-editor></div>
            <div style="--white: #fff; --gray-400: hsl(210, 10%, 53%)"><verbb-editor id="cp" theme="craft"></verbb-editor></div>`);

        expect(await contrast(page, '#light .verbb-editor', 'var(--_border)', 'var(--_bg)')).toBeGreaterThanOrEqual(3);
        // Dark has no surface of its own, so the border is measured against the host's.
        expect(await contrast(page, '#dark .verbb-editor', 'var(--_border)', '#16181d')).toBeGreaterThanOrEqual(3);
        expect(await contrast(page, '#cp .verbb-editor', 'var(--_border)', 'var(--_bg)')).toBeGreaterThanOrEqual(3);
    });

    test('announces each finished upload, together when several finish at once', async ({ page }) => {
        let id = 0;

        await page.route('**/assets/upload', (route) => {
            id++;
            route.fulfill({ json: { asset: { id, url: null, filename: `file-${id}.txt`, kind: 'attachment', size: 10, mimeType: 'text/plain' } } });
        });
        await mountEditor(page, { features: { attachment: true }, craft: { ...craft, uploads: { attachmentExtensions: ['txt'] } } });

        const chooser = page.waitForEvent('filechooser');

        await page.getByRole('button', { name: 'Attach files' }).click();
        await (await chooser).setFiles([
            { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') },
            { name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('plan') },
        ]);
        await expect(page.locator('.verbb-editor > .verbb-editor__sr[role="status"]')).toHaveText('notes.txt uploaded. plan.txt uploaded.');
    });

    test('on a touch screen, Cancel reply, Remove and ALT take a 44px press without growing, and never overlap', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const page = await context.newPage();

        await page.route('**/assets/upload', (route) => route.fulfill({ json: { asset: { id: 3, url: null, filename: 'photo.png', kind: 'inlineImage', mimeType: 'image/png' } } }));
        await openPage(page, `<verbb-editor reply-to="Alex" data-options='${JSON.stringify({ features: { image: true }, craft: { ...craft, uploads: { imageExtensions: ['png'] } } })}'></verbb-editor>`);
        await page.locator('.ProseMirror').evaluate((textbox, png) => {
            const transfer = new DataTransfer();

            transfer.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], 'photo.png', { type: 'image/png' }));
            textbox.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
        }, PNG.toString('base64'));
        await expect(page.locator('.verbb-editor__alt-button')).toBeVisible();

        const hits = await page.evaluate(() => {
            const at = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('button')?.className ?? '';
            const measure = (selector: string) => {
                const box = document.querySelector(selector)!.getBoundingClientRect();
                const x = box.left + box.width / 2;
                const y = box.top + box.height / 2;

                return { size: [Math.round(box.width), Math.round(box.height)], x, y, box };
            };
            const cancel = measure('.verbb-editor__reply button');
            const remove = measure('.verbb-editor__remove');
            const alt = measure('.verbb-editor__alt-button');

            return {
                sizes: [cancel.size, remove.size, alt.size],
                // 20px out from each control's centre, beyond what it draws.
                cancel: [at(cancel.x - 20, cancel.y), at(cancel.x + 20, cancel.y)],
                remove: [at(remove.x + 18, remove.y - 16), at(remove.x - 18, remove.y + 4)],
                alt: [at(alt.x - 20, alt.y + 12), at(alt.x + 20, alt.y - 10)],
            };
        });

        expect(hits.sizes).toEqual([[20, 20], [20, 20], [31, 18]]);
        expect(hits.cancel).toEqual(['verbb-editor__tool', 'verbb-editor__tool']);
        expect(hits.remove).toEqual(['verbb-editor__remove', 'verbb-editor__remove']);
        expect(hits.alt).toEqual(['verbb-editor__alt-button', 'verbb-editor__alt-button']);
        await context.close();
    });

    test('a scrolling toolbar fades on the side with more tools, mirrored right to left', async ({ page }) => {
        const options = JSON.stringify({ toolbar: ['bold', 'italic', 'underline', 'strike', 'code', 'heading', 'bulletList', 'orderedList', 'blockquote', 'link'] });

        await openPage(page, `<div style="width:300px"><verbb-editor id="ltr" preset="full" data-options='${options}'></verbb-editor></div><div style="width:300px" dir="rtl"><verbb-editor id="rtl" preset="full" data-options='${options}'></verbb-editor></div><div style="width:900px"><verbb-editor id="wide" preset="full" data-options='${options}'></verbb-editor></div>`);

        const clipped = (id: string) => page.locator(`#${id} .verbb-editor__toolbar`).evaluate((bar) => [bar.classList.contains('is-clipped-left'), bar.classList.contains('is-clipped-right')]);

        await expect.poll(() => clipped('ltr')).toEqual([false, true]);
        await expect.poll(() => clipped('rtl')).toEqual([true, false]);
        expect(await clipped('wide')).toEqual([false, false]);

        await page.locator('#ltr .verbb-editor__toolbar').evaluate((bar) => bar.scrollTo({ left: bar.scrollWidth }));
        await expect.poll(() => clipped('ltr')).toEqual([true, false]);
        await page.locator('#rtl .verbb-editor__toolbar').evaluate((bar) => bar.scrollTo({ left: -bar.scrollWidth }));
        await expect.poll(() => clipped('rtl')).toEqual([false, true]);
    });

    test('⌘K opens Link without also reaching the page', async ({ page }) => {
        await mountEditor(page, { content: [text('Hi')] });
        await page.evaluate(() => {
            (window as any).shortcuts = 0;
            window.addEventListener('keydown', (event) => {
                if (event.key === 'k' && (event.metaKey || event.ctrlKey)) (window as any).shortcuts++;
            });
        });
        await textbox(page).click();
        await page.keyboard.press('ControlOrMeta+k');
        await expect(page.getByRole('combobox', { name: 'Link address or page' })).toBeFocused();
        expect(await page.evaluate(() => (window as any).shortcuts)).toBe(0);
    });

    test('on a touch screen the bubble stays off and the toolbar still formats', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const page = await context.newPage();

        await mountEditor(page, { content: [text('Hello world')] });
        await textbox(page).tap();
        await page.evaluate(() => {
            const node = document.querySelector('.ProseMirror p')!.firstChild!;
            const range = document.createRange();

            range.setStart(node, 0);
            range.setEnd(node, 5);
            getSelection()!.removeAllRanges();
            getSelection()!.addRange(range);
        });
        await page.waitForTimeout(100);
        await expect(page.locator('.verbb-editor__bubble')).toHaveCount(0);
        await page.locator('[data-command="bold"]').tap();
        await expect(page.locator('.ProseMirror strong')).toHaveText('Hello');
        await context.close();
    });
});
