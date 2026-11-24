import { expect, test, type Page, type Route } from '@playwright/test';

import { craft, mentionResponse, mountEditor, openPage, PNG, textbox } from './helpers';

/**
 * The `request` option in a real browser: headers on mention searches and uploads, read fresh for
 * each request, and the credentials mode deciding whether a request to another origin succeeds.
 */

const uploaded = { asset: { id: 42, filename: 'photo.png', kind: 'inlineImage', url: null, temporary: true } };

async function pickPhoto(page: Page): Promise<void> {
    const chooser = page.waitForEvent('filechooser');

    await page.getByRole('button', { name: /Attach files|Add photos/ }).click();
    await (await chooser).setFiles([{ name: 'photo.png', mimeType: 'image/png', buffer: PNG }]);
}

async function mention(page: Page): Promise<void> {
    await textbox(page).click();
    await page.keyboard.type('@Al');
}

test.describe('request option', () => {
    test('sends a fresh token from a headers function with every search and upload', async ({ page }) => {
        const seen: { path: string; authorization?: string; profile?: string; csrf?: string }[] = [];
        const record = async (route: Route, body: unknown) => {
            const headers = await route.request().allHeaders();

            seen.push({ path: new URL(route.request().url()).searchParams.get('p') ?? '', authorization: headers.authorization, profile: headers['x-comments-profile'], csrf: headers['x-csrf-token'] });
            await route.fulfill({ json: body });
        };

        await page.route('**/mentions/search', (route) => record(route, mentionResponse(['Alice'])));
        await page.route('**/assets/upload', (route) => record(route, uploaded));
        await openPage(page, '<div id="editor"></div>');
        await page.evaluate(async (craftOptions) => {
            let token = 0;
            const { VerbbEditor } = window as unknown as { VerbbEditor: { Editor: { create(element: string, options: unknown): Promise<unknown> } } };

            (window as unknown as { editor: unknown }).editor = await VerbbEditor.Editor.create('#editor', {
                features: { mention: true, image: true },
                craft: { ...craftOptions, uploads: { imageExtensions: ['png'] } },
                request: {
                    headers: async () => ({ Authorization: `Bearer token-${++token}`, 'X-Comments-Profile': 'cross-origin-member', 'X-CSRF-Token': 'not this one' }),
                },
            });
        }, craft);

        await mention(page);
        await expect(page.getByRole('option', { name: 'Alice' })).toBeVisible();
        await page.keyboard.press('Escape');
        await pickPhoto(page);
        await expect(page.getByRole('button', { name: 'Add alt text for photo.png' })).toBeVisible();

        const searches = seen.filter((request) => request.path.includes('mentions'));
        const uploads = seen.filter((request) => request.path.includes('upload'));

        expect(searches.length).toBeGreaterThan(0);
        expect(uploads).toHaveLength(1);
        // Every request asked for the token again, so none repeats.
        expect(new Set(seen.map((request) => request.authorization)).size).toBe(seen.length);
        expect(seen.every((request) => /^Bearer token-\d+$/.test(request.authorization ?? '') && request.profile === 'cross-origin-member' && request.csrf === 'token-value')).toBe(true);
    });

    test('takes its request option from the editor element’s options property', async ({ page }) => {
        let authorization: string | undefined;

        await page.route('**/mentions/search', async (route) => {
            authorization = (await route.request().allHeaders()).authorization;
            await route.fulfill({ json: mentionResponse(['Alice']) });
        });
        await openPage(page, '<verbb-editor aria-label="Reply"></verbb-editor>');
        await page.evaluate((craftOptions) => {
            const element = document.querySelector('verbb-editor') as HTMLElement & { options: unknown };

            element.setAttribute('data-options', JSON.stringify({ features: { mention: true }, craft: craftOptions, request: { credentials: 'same-origin' } }));
            element.options = { request: { headers: () => ({ Authorization: 'Bearer element' }) } };
        }, craft);

        await mention(page);
        await expect(page.getByRole('option', { name: 'Alice' })).toBeVisible();
        expect(authorization).toBe('Bearer element');
    });

    test('applies the credentials mode to searches and uploads on another origin', async ({ page }) => {
        const pageOrigin = 'http://127.0.0.1:4173';
        const otherOrigin = 'http://localhost:4173';
        // A credentialed response must name the origin and allow credentials, or the browser refuses it.
        const answer = (allowCredentials: boolean) => async (route: Route) => {
            const cors = {
                'Access-Control-Allow-Origin': pageOrigin,
                'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
                'Access-Control-Allow-Methods': 'POST',
                ...(allowCredentials ? { 'Access-Control-Allow-Credentials': 'true' } : {}),
            };

            if (route.request().method() === 'OPTIONS') {
                await route.fulfill({ status: 204, headers: cors });

                return;
            }

            await route.fulfill({ headers: cors, json: route.request().url().includes('upload') ? uploaded : mentionResponse(['Alice']) });
        };
        const mount = async (credentials: string | undefined, allowCredentials: boolean) => {
            await page.unrouteAll();
            await page.route(`${otherOrigin}/**`, answer(allowCredentials));
            await mountEditor(page, {
                features: { mention: true, image: true },
                craft: {
                    context: 'sample.reply',
                    csrfToken: false,
                    endpoints: { mentions: `${otherOrigin}/actions/comments/api/mentions`, upload: `${otherOrigin}/actions/comments/api/upload` },
                    uploads: { imageExtensions: ['png'] },
                },
                ...(credentials ? { request: { credentials } } : {}),
            });
        };
        const outcome = async () => {
            await mention(page);

            const searched = await page.getByRole('option', { name: 'Alice' }).waitFor({ timeout: 3000 }).then(() => true, () => false);

            await page.keyboard.press('Escape');
            await pickPhoto(page);

            const uploadedOk = await page.getByRole('button', { name: 'Add alt text for photo.png' }).waitFor({ timeout: 3000 }).then(() => true, () => false);

            return { searched, uploaded: uploadedOk };
        };

        // Without credentials, a response that doesn't allow them is fine.
        await mount(undefined, false);
        expect(await outcome()).toEqual({ searched: true, uploaded: true });

        // With them, the browser insists the other origin allows credentials, for fetch and XHR alike.
        await mount('include', false);
        expect(await outcome()).toEqual({ searched: false, uploaded: false });

        await mount('include', true);
        expect(await outcome()).toEqual({ searched: true, uploaded: true });
    });
});
