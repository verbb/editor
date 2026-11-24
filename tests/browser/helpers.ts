import { expect, type Page } from '@playwright/test';

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

export const craft = {
    context: 'sample.reply',
    csrfTokenName: 'CRAFT_CSRF_TOKEN',
    csrfToken: 'token-value',
    endpoints: {
        upload: '/index.php?p=actions/verbb-editor/assets/upload',
        mentions: '/index.php?p=actions/verbb-editor/mentions/search',
        elements: '/index.php?p=actions/verbb-editor/elements/search',
    },
    scope: { ownerId: 7 },
};

/** Opens the host page with the real bundle loaded as a module, as Craft registers it. */
export async function openPage(page: Page, html = ''): Promise<void> {
    await page.goto('/');
    await page.evaluate(async (markup) => {
        document.body.innerHTML = markup;
        await import('/dist/editor.js' as string);
        await customElements.whenDefined('verbb-editor');
        // Features load on demand, so an element's editor arrives a moment after the element.
        await Promise.all([...document.querySelectorAll<HTMLElement & { ready: Promise<unknown> }>('verbb-editor, verbb-editor-input')].map((element) => element.ready));
    }, html);
}

export async function mountEditor(page: Page, options: Record<string, unknown> = {}, html = '<div id="editor"></div>'): Promise<void> {
    await openPage(page, html);
    await page.evaluate(async (editorOptions) => {
        const { VerbbEditor } = window as unknown as { VerbbEditor: { Editor: { create(element: string, options: unknown): Promise<unknown> } } };

        (window as unknown as { editor: unknown }).editor = await VerbbEditor.Editor.create('#editor', editorOptions);
    }, options);
}

export function textbox(page: Page) {
    return page.locator('.ProseMirror');
}

export function json(page: Page): Promise<unknown> {
    return page.evaluate(() => (window as unknown as { editor: { getJSON(): unknown } }).editor.getJSON());
}

export const mentionResponse = (labels: string[]) => ({
    results: labels.map((label, index) => ({ id: index + 1, type: 'craft\\elements\\User', label })),
});

export async function routeMentions(page: Page, respond: (query: string) => unknown): Promise<string[]> {
    const queries: string[] = [];

    await page.route('**/mentions/search', async (route) => {
        const { query } = route.request().postDataJSON();

        queries.push(query);
        await route.fulfill({ json: respond(query) as Record<string, unknown> });
    });

    return queries;
}

export async function expectNoSubmit(page: Page): Promise<void> {
    expect(await page.evaluate(() => (window as unknown as { submits: number }).submits)).toBe(0);
}
