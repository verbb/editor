import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { PNG } from './helpers';

/**
 * The whole path a consumer's page takes: PHP options, the shipped bundle and the real endpoints,
 * with a real session and CSRF token. Needs the disposable Craft test install.
 */
test('mentions and uploads reach the real endpoints with options from PHP', async ({ page, baseURL }) => {
    const fixtures = JSON.parse(execFileSync('php', [resolve(__dirname, '../bin/e2e-fixtures.php')], { encoding: 'utf8' }));
    const session = await page.request.get(`${baseURL}/actions/users/session-info`, { headers: { Accept: 'application/json' } });
    const { csrfTokenValue } = await session.json();
    const login = await page.request.post(`${baseURL}/actions/users/login`, {
        headers: { Accept: 'application/json', 'X-CSRF-Token': csrfTokenValue },
        data: { loginName: fixtures.username, password: fixtures.password },
    });

    expect(login.ok()).toBe(true);

    await page.goto('/__e2e?context=http.open');
    await page.waitForFunction(() => (window as any).editorReady === true);

    await page.locator('.ProseMirror').click();
    await page.keyboard.type('@E2e');
    await expect(page.getByRole('option', { name: 'E2e Findable' })).toBeVisible();
    await page.keyboard.press('Enter');

    let document = await page.evaluate(() => (window as any).editor.getJSON());

    expect(document[0].content[0]).toEqual({ type: 'mention', attrs: { id: fixtures.id, type: 'craft\\elements\\User', label: 'E2e Findable' } });

    const chooser = page.waitForEvent('filechooser');

    await page.locator('[data-command="attach"]').click();
    await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.verbb-editor__tray [data-tray="alt"]')).toHaveCount(1);

    document = await page.evaluate(() => (window as any).editor.getJSON());

    const image = document.flatMap((node: any) => (node.type === 'editorAsset' ? [node] : []))[0];

    expect(image.attrs.id).toBeGreaterThan(0);
    expect(image.attrs.src).toBeUndefined();
});
