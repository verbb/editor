import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { openPage } from './helpers';

/**
 * The XSS corpus in a real browser, on both paths that put a document on a page: the HTML Editor's
 * PHP renderer produces, which a consumer inserts as markup, and the editor itself, through
 * `importHTML()`, `setContent()` and `getHTML()`. Nothing may run, and the browser must build
 * exactly the elements the renderer wrote.
 */

const corpus = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/xss.json'), 'utf8')) as { html: string[]; strings: string[]; urls: string[] };

type Rendered = { source: string; html: string };

const ALLOWED: Record<string, string[]> = {
    p: [], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], ul: [], ol: ['start'], li: [], blockquote: [],
    strong: [], em: [], s: [], u: [], code: [], br: [],
    a: ['href', 'target', 'rel', 'class', 'data-craft-link-id', 'data-craft-link-type', 'data-craft-link-label', 'data-editor-attachment-id', 'data-filename', 'data-mime-type', 'data-size'],
    img: ['src', 'alt', 'title', 'data-editor-asset-id'],
    span: ['class', 'data-mention-id', 'data-mention-type', 'data-label'],
};

/** Runs in the page: counts anything that executes, and inspects markup without running it. */
function installChecks(allowed: Record<string, string[]>): void {
    const page = window as unknown as Record<string, unknown>;
    const hits: string[] = [];

    page.__xssHits = hits;
    window.alert = (value?: unknown) => { hits.push(String(value)); };
    window.confirm = (value?: string) => { hits.push(String(value)); return false; };
    window.prompt = (value?: string) => { hits.push(String(value)); return null; };

    const safeUrl = (element: Element, attribute: string): boolean => {
        const value = element.getAttribute(attribute);

        if (value === null) return true;

        // Resolve the way the browser will when it follows or loads it.
        const protocol = new URL(value, location.href).protocol;

        return ['http:', 'https:', 'mailto:'].includes(protocol);
    };

    page.__xssProblems = (container: Element, strict: boolean): string[] => {
        const problems: string[] = [];

        for (const element of container.querySelectorAll('*')) {
            const name = element.localName;

            if (strict && !(name in allowed)) problems.push(`<${name}> isn't allowed`);
            if (['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'style', 'form', 'template', 'svg', 'math', 'frame', 'frameset'].includes(name)) problems.push(`<${name}>`);
            if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') problems.push(`<${name}> in ${element.namespaceURI}`);

            for (const attribute of element.getAttributeNames()) {
                if (/^on/i.test(attribute) || ['srcdoc', 'formaction', 'xlink:href', 'style'].includes(attribute.toLowerCase())) problems.push(`${attribute} on <${name}>`);
                if (strict && !(allowed[name] ?? []).includes(attribute)) problems.push(`${attribute} isn't allowed on <${name}>`);
            }

            for (const attribute of ['href', 'src', 'action', 'cite', 'background']) {
                if (!safeUrl(element, attribute)) problems.push(`${attribute}="${element.getAttribute(attribute)}" on <${name}>`);
            }
        }

        return problems;
    };
}

async function settle(page: Page): Promise<void> {
    // Long enough for a failed image's error event, which is when an onerror handler would run.
    await page.waitForTimeout(250);
}

test.describe('XSS corpus', () => {
    test('the checks catch an unsanitised payload, so a pass means something', async ({ page }) => {
        await openPage(page, '<div id="live"></div>');
        await page.evaluate(installChecks, ALLOWED);

        const problems = await page.evaluate(() => {
            const live = document.querySelector('#live')!;

            live.innerHTML = '<img src="x" onerror="alert(1)"><a href="javascript:alert(2)">x</a>';

            const problems = (window as unknown as { __xssProblems(container: Element, strict: boolean): string[] }).__xssProblems(live, true);

            // A link inside a link is one way markup parses into a different tree.
            live.innerHTML = '<p><a href="/a"><a href="/b">nested</a></a></p>';

            return [...problems, live.innerHTML];
        });

        await settle(page);

        expect(problems).toEqual(expect.arrayContaining(['onerror on <img>', 'href="javascript:alert(2)" on <a>', '<p><a href="/a"></a><a href="/b">nested</a></p>']));
        expect(await page.evaluate(() => (window as unknown as { __xssHits: string[] }).__xssHits)).toEqual(['1']);
    });

    test('PHP-rendered documents run nothing and parse exactly as written', async ({ page }) => {
        const rendered = JSON.parse(execFileSync('php', [resolve(__dirname, '../bin/xss-render.php')], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })) as Rendered[];

        expect(rendered.length).toBeGreaterThan(corpus.html.length);

        await openPage(page);
        await page.evaluate(installChecks, ALLOWED);

        const failures = await page.evaluate(async (documents) => {
            const page = window as unknown as { __xssProblems(container: Element, strict: boolean): string[] };
            const failures: string[] = [];
            const live = document.createElement('div');

            document.body.append(live);

            for (const { source, html } of documents) {
                // Live, so images load and any handler would fire.
                live.innerHTML = html;

                const problems = page.__xssProblems(live, true);
                // The tree the markup describes, read from its tags, against the tree the browser built.
                const written = [...html.matchAll(/<(\/?)([a-z][a-z0-9]*)[^>]*>/g)]
                    .map(([, closing, name]) => (closing ? ')' : ['br', 'img'].includes(name) ? `${name}()` : `${name}(`))
                    .join('');
                const shape = (element: Element): string => [...element.children].map((child) => `${child.localName}(${shape(child)})`).join('');
                const parsed = shape(live);

                // Mutation XSS needs the parser to build something other than what was written.
                if (written !== parsed) problems.push(`parsed as ${parsed} rather than ${written}`);

                const again = document.createElement('div');

                again.innerHTML = live.innerHTML;

                if (again.innerHTML !== live.innerHTML) problems.push('changed when serialised and parsed again');
                if (problems.length) failures.push(`${JSON.stringify(source)}\n  ${html}\n  ${problems.join('; ')}`);
            }

            await new Promise((resolve) => setTimeout(resolve, 250));
            live.remove();

            return failures;
        }, rendered);

        await settle(page);

        expect(failures).toEqual([]);
        expect(await page.evaluate(() => (window as unknown as { __xssHits: string[] }).__xssHits)).toEqual([]);
    });

    test('the editor imports, shows and previews hostile content without running it', async ({ page }) => {
        await openPage(page, '<div id="editor"></div><div id="preview"></div>');
        await page.evaluate(installChecks, ALLOWED);

        const failures = await page.evaluate(async ({ html, strings, urls }) => {
            const page = window as unknown as {
                VerbbEditor: { Editor: { create(element: string, options: unknown): Promise<{ importHTML(html: string): void; setContent(content: unknown): void; getHTML(): string; destroy(): void }> } };
                __xssProblems(container: Element, strict: boolean): string[];
            };
            const editor = await page.VerbbEditor.Editor.create('#editor', {
                features: { bold: true, italic: true, strike: true, underline: true, headings: [1, 2, 3], lists: true, blockquote: true, code: true, link: true, craftLink: true, image: true, attachment: true, mention: true },
            });
            const content = document.querySelector('#editor')!;
            const preview = document.querySelector('#preview')!;
            const failures: string[] = [];
            const check = (source: string) => {
                // The preview is live too: a host might show it.
                preview.innerHTML = editor.getHTML();

                const problems = [
                    ...page.__xssProblems(content.querySelector('.ProseMirror')!, false).map((problem) => `editing: ${problem}`),
                    ...page.__xssProblems(preview, false).map((problem) => `getHTML(): ${problem}`),
                ];

                if (problems.length) failures.push(`${JSON.stringify(source)}: ${problems.join('; ')}`);
            };

            for (const payload of html) {
                editor.importHTML(payload);
                check(payload);
            }

            strings.forEach((string, index) => {
                const url = urls[index % urls.length];

                editor.setContent([
                    { type: 'paragraph', attrs: { onclick: string }, content: [
                        { type: 'text', text: string, marks: [{ type: 'link', attrs: { href: url, class: string, target: string } }] },
                        { type: 'text', text: string, marks: [{ type: 'craftLink', attrs: { id: 1, type: 'entry', label: string, href: url } }] },
                        { type: 'mention', attrs: { id: 2, type: string, label: string } },
                    ] },
                    { type: 'editorAsset', attrs: { id: 3, src: url, alt: string, title: string, onerror: string } },
                    { type: 'attachment', attrs: { id: 4, url, filename: string, mimeType: string } },
                    { type: 'script', content: [{ type: 'text', text: string }] },
                ]);
                check(`${string} / ${url}`);
            });

            await new Promise((resolve) => setTimeout(resolve, 250));
            editor.destroy();

            return failures;
        }, corpus);

        await settle(page);

        expect(failures).toEqual([]);
        expect(await page.evaluate(() => (window as unknown as { __xssHits: string[] }).__xssHits)).toEqual([]);
    });
});
