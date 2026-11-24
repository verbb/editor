import { afterEach, describe, expect, it, vi } from 'vitest';

import { Editor, registerVerbbEditorElement, registerVerbbEditorInputElement, VerbbEditorElement } from '../src';
import { DEFAULT_LABELS, formatLabel } from '../src/config/labels';
import { normalizeOptions } from '../src/config/normalizeOptions';
import { CraftClient } from '../src/craft/Client';
import { EditorSetupError } from '../src/craft/csrf';
import { contentIsEmpty, contentTextLength, contentToPlainText, normalizeContent } from '../src/core/document';
import { normalizeLinkInput, safeUrl } from '../src/core/urls';

import labelsSource from '../../../src/helpers/Labels.php?raw';
import { stubUploads } from './xhr';
import urlRules from '../../../tests/fixtures/urls.json';

const editors: Editor[] = [];

afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

function mount(options: ConstructorParameters<typeof Editor>[1] = {}) {
    const host = document.createElement('div');
    document.body.append(host);

    const editor = new Editor(host, options);
    editors.push(editor);

    return { editor, host };
}

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('string input', () => {
    it.each(['123', 'true', 'false', 'null', '3.14', '[1,2]', '[]', '{"a":1}', '{"type":"paragraph"}', '[{"type":1}]', 'plain words'])('keeps %s as literal text', (value) => {
        expect(normalizeContent(value)).toEqual([paragraph(value)]);
        expect(mount({ content: value }).editor.getText()).toBe(value);
    });

    it('reads document-shaped strings as documents', () => {
        expect(normalizeContent(JSON.stringify({ type: 'doc', content: [paragraph('a')] }))).toEqual([paragraph('a')]);
        expect(normalizeContent(JSON.stringify([paragraph('a')]))).toEqual([paragraph('a')]);
        expect(normalizeContent(JSON.stringify({ type: 'doc', content: [] }))).toEqual([]);
    });

    it('strips the same invisible characters as the server and keeps joiners', () => {
        expect(normalizeContent('a​b⁠c﻿d')).toEqual([paragraph('abcd')]);
        expect(normalizeContent('فارسی‌نویسی 👩‍💻')).toEqual([paragraph('فارسی‌نویسی 👩‍💻')]);
    });
});

describe('empty documents', () => {
    it.each([
        [[], true],
        [[{ type: 'paragraph' }], true],
        [[paragraph('   \n\t')], true],
        [[paragraph(' ')], true],
        [[{ type: 'paragraph', content: [{ type: 'hardBreak' }] }], true],
        [[{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }], true],
        [[paragraph('a')], false],
        [[{ type: 'editorAsset', attrs: { id: 1 } }], false],
        [[{ type: 'attachment', attrs: { id: 1 } }], false],
        [[{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 1, type: 'user', label: 'A' } }] }], false],
        [[{ type: 'callout' }], false],
    ])('%j is empty: %s', (content, empty) => {
        expect(contentIsEmpty(content)).toBe(empty);
    });

    it('applies the rule through the editor', () => {
        expect(mount({ content: [paragraph('   ')] }).editor.isEmpty()).toBe(true);
        expect(mount({ content: [{ type: 'editorAsset', attrs: { id: 1 } }], features: { image: true } }).editor.isEmpty()).toBe(false);
    });
});

describe('text length', () => {
    it('counts what the server counts for limits', () => {
        // Blank lines between blocks count, as in the server's plain text.
        expect(contentTextLength([paragraph('One'), paragraph('Two')])).toBe(8);
        // Mentions count as @label, and media alt text and filenames don't count.
        expect(contentTextLength([
            { type: 'paragraph', content: [{ type: 'text', text: 'Hi ' }, { type: 'mention', attrs: { id: 1, type: 'user', label: 'Al' } }] },
            { type: 'editorAsset', attrs: { id: 2, alt: 'Photo' } },
            { type: 'attachment', attrs: { id: 3, filename: 'Paper.pdf' } },
        ])).toBe(6);
        // Unicode characters, as PHP's mb_strlen() counts, not UTF-16 units.
        expect(contentTextLength([paragraph('Party 🎉')])).toBe(7);
        expect(contentTextLength([])).toBe(0);
    });
});

describe('plain text', () => {
    it('produces the same output as the server', () => {
        const list = { type: 'bulletList', content: [
            { type: 'listItem', content: [paragraph('One'), { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph('Nested')] }] }] },
            { type: 'listItem', content: [paragraph('Two')] },
        ] };

        expect(contentToPlainText([paragraph('One'), paragraph('Two')])).toBe('One\n\nTwo');
        expect(contentToPlainText([list])).toBe('One\nNested\nTwo');
        expect(contentToPlainText([{ type: 'blockquote', content: [paragraph('A'), paragraph('B')] }, paragraph('C')])).toBe('A\nB\n\nC');
        expect(contentToPlainText([{ type: 'paragraph', content: [{ type: 'text', text: 'A' }, { type: 'hardBreak' }, { type: 'text', text: 'B' }] }])).toBe('A\nB');
        expect(contentToPlainText([
            { type: 'paragraph', content: [{ type: 'text', text: 'Hi ' }, { type: 'mention', attrs: { id: 1, type: 'user', label: 'Al' } }] },
            { type: 'editorAsset', attrs: { id: 2, alt: 'Photo' } },
            { type: 'attachment', attrs: { id: 3, filename: 'Paper.pdf' } },
        ])).toBe('Hi @Al\n\nPhoto\n\nPaper.pdf');
    });

    it('is what the editor reports', () => {
        const { editor } = mount({ content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('One')] }, { type: 'listItem', content: [paragraph('Two')] }] }, paragraph('After')] });

        expect(editor.getText()).toBe('One\nTwo\n\nAfter');
    });
});

describe('fitting content to the schema', () => {
    const heading = (level: unknown, text = 'Title') => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });

    it.each([
        [[2, 3], 2, 2],
        [[2, 3], 1, 2],
        [[2, 3], 6, 3],
        [[2, 3], 9, 3],
        [[2, 4], 3, 2],
    ])('with levels %j, heading %i becomes %i', (levels, level, expected) => {
        const { editor } = mount({ content: [heading(level)], features: { headings: levels } });

        expect(editor.getJSON()[0].attrs).toEqual({ level: expected });
    });

    it.each([[[]], [false]])('turns headings into paragraphs when headings are %j', (headings) => {
        const { editor } = mount({ content: [heading(2)], preset: 'minimal', features: { headings } });

        expect(editor.getJSON()).toEqual([paragraph('Title')]);
    });

    it('keeps blocks separate when a feature is off', () => {
        const { editor } = mount({
            preset: 'minimal',
            content: [
                paragraph('Intro'),
                heading(2),
                { type: 'blockquote', content: [paragraph('Quote A'), paragraph('Quote B')] },
                { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('One')] }, { type: 'listItem', content: [paragraph('Two')] }] },
                { type: 'unknownWrapper', content: [{ type: 'text', text: 'Wrapped A' }] },
                { type: 'unknownWrapper', content: [{ type: 'text', text: 'Wrapped B' }] },
            ],
        });

        expect(editor.getText()).toBe('Intro\n\nTitle\n\nQuote A\n\nQuote B\n\nOne\n\nTwo\n\nWrapped A\n\nWrapped B');
        expect(editor.isDirty()).toBe(false);
    });

    it('turns a disabled mention into its label and removes disabled media', () => {
        const { editor } = mount({
            preset: 'minimal',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Hi ' }, { type: 'mention', attrs: { id: 1, type: 'user', label: 'Alice' } }, { type: 'text', text: ' ok' }] },
                { type: 'editorAsset', attrs: { id: 2, alt: 'Photo' } },
                { type: 'attachment', attrs: { id: 3 } },
            ],
        });

        expect(editor.getJSON()).toEqual([paragraph('Hi @Alice ok')]);
    });

    it('repairs invalid structure instead of failing', () => {
        const { editor } = mount({
            content: [
                { type: 'listItem', content: [paragraph('orphan item')] },
                { type: 'text', text: 'root text' },
                { type: 'paragraph', content: [paragraph('nested p')] },
                { type: 'bulletList', content: [paragraph('bare item')] },
                { type: 'blockquote', content: [{ type: 'text', text: 'bare quote' }] },
            ],
        });

        expect(editor.getHTML()).toBe('<p>orphan item</p><p>root text</p><p>nested p</p><ul><li><p>bare item</p></li></ul><blockquote><p>bare quote</p></blockquote>');
    });

    it('keeps an ordered list start', () => {
        const { editor } = mount({ content: [{ type: 'orderedList', attrs: { start: 5 }, content: [{ type: 'listItem', content: [paragraph('Five')] }] }] });

        expect(editor.getJSON()[0].attrs).toMatchObject({ start: 5 });
    });

    it('treats empty heading levels as off', () => {
        expect(normalizeOptions({ features: { headings: [] } }).features.headings).toBe(false);
        expect(normalizeOptions({ features: { headings: true } }).features.headings).toEqual([2, 3]);
    });
});

describe('references', () => {
    const resolved = [
        { type: 'paragraph', content: [
            { type: 'text', text: 'Entry', marks: [{ type: 'craftLink', attrs: { id: 7, type: 'entry', label: 'Entry', href: '/entry' } }] },
        ] },
        { type: 'editorAsset', attrs: { id: 9, src: '/i.png', alt: 'Alt', title: null } },
        { type: 'attachment', attrs: { id: 10, url: '/f.pdf', filename: 'Paper', mimeType: 'application/pdf', size: 5 } },
    ];
    const features = { craftLink: true, image: true, attachment: true };

    it('keeps resolved values for display and out of submitted JSON', () => {
        const { editor, host } = mount({ content: resolved, features, craft: { csrfToken: false } });

        expect(host.querySelector('.verbb-editor__tray img')?.getAttribute('src')).toBe('/i.png');
        expect(host.querySelector('.verbb-editor__file b')?.textContent).toBe('Paper');
        expect(JSON.stringify(editor.getJSON())).not.toMatch(/\/i\.png|\/f\.pdf|\/entry|Paper|application\/pdf/);
    });

    it('does not mark resolved content dirty, and the reference form compares equal', () => {
        const { editor } = mount({ content: resolved, features });

        expect(editor.isDirty()).toBe(false);

        const submitted = editor.getJSON();

        editor.setContent(submitted);
        expect(editor.isDirty()).toBe(false);
    });

    it('shows media in the tray rather than the text, and submits it after the text', () => {
        const mixed = [resolved[1], resolved[0], { type: 'blockquote', content: [resolved[2]] }];
        const { editor, host } = mount({ content: mixed, features });

        expect(host.querySelector('.ProseMirror img, .ProseMirror .verbb-editor-attachment')).toBeNull();
        expect(host.querySelectorAll('.verbb-editor__tray [data-key]')).toHaveLength(2);
        // A quote left empty by the move goes too.
        expect(editor.getJSON().map((node) => node.type)).toEqual(['paragraph', 'editorAsset', 'attachment']);
    });

    it('moves media pasted as HTML into the tray', () => {
        const { editor, host } = mount({ features });

        editor.importHTML('<p>Hi</p><img data-editor-asset-id="9" src="/i.png" alt="A"><p>there</p>');

        expect(host.querySelector('.ProseMirror img')).toBeNull();
        expect(editor.getJSON()).toEqual([paragraph('Hi'), paragraph('there'), { type: 'editorAsset', attrs: { id: 9, alt: 'A', title: null } }]);
    });
});

describe('url rules', () => {
    it.each(urlRules.map((row) => [row.url, row.link, row.resource] as const))('%j: link %s, resource %s', (url, link, resource) => {
        expect(safeUrl(url) !== '').toBe(link);
        expect(safeUrl(url, true) !== '').toBe(resource);
    });

    it('fixes up what authors type into the link panel', () => {
        expect(normalizeLinkInput('example.com')).toBe('https://example.com');
        expect(normalizeLinkInput('www.example.com/a?b=c')).toBe('https://www.example.com/a?b=c');
        expect(normalizeLinkInput('me@example.com')).toBe('mailto:me@example.com');
        expect(normalizeLinkInput('/about')).toBe('/about');
        expect(normalizeLinkInput('./about')).toBe('./about');
        expect(normalizeLinkInput('../about')).toBe('../about');
        expect(normalizeLinkInput('#top')).toBe('#top');
        expect(normalizeLinkInput('?page=2')).toBe('?page=2');
        expect(normalizeLinkInput('https://x.y')).toBe('https://x.y');
        expect(normalizeLinkInput('javascript:alert(1)')).toBe('javascript:alert(1)');
        expect(normalizeLinkInput('about')).toBe('about');
    });
});

describe('link safety in the editor', () => {
    it.each(['javascript:alert(1)', 'java&#x73;cript:alert(1)', 'data:text/html,x'])('drops the unsafe link %s on import', (href) => {
        const { editor } = mount();

        editor.importHTML(`<p><a href="${href}">Text</a></p>`);

        expect(editor.getText()).toBe('Text');
        expect(JSON.stringify(editor.getJSON())).not.toContain('href');
    });

    it('keeps safe links with their rel and target defaults', () => {
        const { editor } = mount();

        editor.importHTML('<p><a href="https://verbb.io">Text</a></p>');

        expect(editor.getHTML()).toContain('href="https://verbb.io"');
        expect(editor.getHTML()).toContain('rel="noopener noreferrer nofollow"');
    });
});

describe('labels', () => {
    it('matches the server’s keys and English text', () => {
        const server = Object.fromEntries([...labelsSource.matchAll(/'(\w+)' => '((?:[^'\\]|\\.)*)',/g)].map((match) => [match[1], match[2].replace(/\\'/g, '\'')]));

        expect(server).toEqual(DEFAULT_LABELS);
    });

    it('formats placeholders and leaves unknown ones alone', () => {
        expect(formatLabel('Heading {level}', { level: 2 })).toBe('Heading 2');
        expect(formatLabel('{a} {b}', { a: 1 })).toBe('1 {b}');

        // ICU plurals, as Craft's translations write them.
        const tooLong = '{count, plural, one{Too long by # character} other{Too long by # characters}}';
        expect(formatLabel(tooLong, { count: 1 })).toBe('Too long by 1 character');
        expect(formatLabel(tooLong, { count: 12 })).toBe('Too long by 12 characters');
        expect(formatLabel(tooLong, { count: 0 })).toBe('Too long by 0 characters');
        expect(formatLabel('{count, plural, =0{None left} one{# left} other{# left}}', { count: 0 })).toBe('None left');
        expect(formatLabel('{count, plural, one{# of {limit}} other{# of {limit}}}', { count: 1, limit: 5 })).toBe('1 of 5');
        // Without a value the message is left alone, as a plain placeholder is.
        expect(formatLabel(tooLong, {})).toBe(tooLong);
        expect(formatLabel(DEFAULT_LABELS.charactersLeft, { count: 1 })).toBe('1 character left');
    });

    it('uses supplied labels throughout the interface', () => {
        const { host } = mount({ features: { bold: true }, labels: { bold: 'Fett', toolbar: 'Werkzeuge', editor: 'Nachricht' } });

        expect(host.querySelector('[data-command="bold"]')?.getAttribute('aria-label')).toBe('Fett');
        expect(host.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe('Werkzeuge');
        expect(host.querySelector('.ProseMirror')?.getAttribute('aria-label')).toBe('Nachricht');
    });

    it('prefers an explicit accessible name', () => {
        expect(mount({ ariaLabel: 'Your message' }).host.querySelector('.ProseMirror')?.getAttribute('aria-label')).toBe('Your message');

        const labelled = mount({ ariaLabelledBy: 'heading-id' }).host.querySelector('.ProseMirror');

        expect(labelled?.getAttribute('aria-labelledby')).toBe('heading-id');
        expect(labelled?.hasAttribute('aria-label')).toBe(false);
    });
});

describe('transport', () => {
    const endpoints = { upload: '/u', mentions: '/m', elements: '/e' };

    it('sends the session with the request', async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) });

        vi.stubGlobal('fetch', fetcher);
        await new CraftClient({ endpoints, csrfToken: false }).searchMentions('x');

        expect(fetcher.mock.calls[0][1].credentials).toBe('same-origin');
        expect(fetcher.mock.calls[0][1].method).toBe('POST');
        expect(fetcher.mock.calls[0][1].headers.Accept).toBe('application/json');
    });

    it('raises a developer error when no token resolves', async () => {
        vi.stubGlobal('fetch', vi.fn());

        await expect(new CraftClient({ endpoints }).searchMentions('x')).rejects.toThrow('CSRF');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('raises a developer error when an endpoint is missing', async () => {
        await expect(new CraftClient({ csrfToken: false }).searchMentions('x')).rejects.toThrow('browserOptions');
    });

    it('sends no token when the site has CSRF protection off', async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) });

        vi.stubGlobal('fetch', fetcher);
        await new CraftClient({ endpoints, csrfToken: false, csrfTokenName: 'x', context: 'a' }).searchMentions('hi');

        expect(fetcher.mock.calls[0][1].headers['X-CSRF-Token']).toBeUndefined();
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ query: 'hi', context: 'a' });
    });

    it('passes server messages through and hides other failures', async () => {
        const client = new CraftClient({ endpoints, csrfToken: false });

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'File type is not permitted.' }) }));
        await expect(client.searchMentions('x')).rejects.toThrow('File type is not permitted.');

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'stack trace' }) }));
        await expect(client.searchMentions('x')).rejects.toThrow('Something went wrong');

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ other: [] }) }));
        await expect(client.searchMentions('x')).rejects.toThrow('Something went wrong');
    });

    it('sends scope through uploads as a JSON field', async () => {
        const requests = stubUploads(() => ({ status: 200, body: { asset: { id: 1, filename: 'x.png', kind: 'inlineImage', url: null } } }));

        await new CraftClient({ endpoints, csrfToken: 'token', csrfTokenName: 'csrf', context: 'a', scope: { ownerId: 3 } }).uploadAsset(new File(['x'], 'x.png'));

        const body = requests[0].body!;

        expect(body.get('scope')).toBe('{"ownerId":3}');
        expect(body.get('csrf')).toBe('token');
        expect(body.get('context')).toBe('a');
        expect(requests[0].url).toBe('/u');
        // Same-origin by default, as for searches: cookies only go to another origin when asked.
        expect(requests[0].withCredentials).toBe(false);
        expect(requests[0].headers.Accept).toBe('application/json');
        expect(requests[0].headers['X-CSRF-Token']).toBe('token');
    });
});

describe('request option', () => {
    const endpoints = { upload: '/u', mentions: '/m', elements: '/e' };
    const results = () => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) });
    const uploaded = { status: 200, body: { asset: { id: 1, filename: 'x.png', kind: 'inlineImage', url: null } } };

    it('adds headers to searches and uploads', async () => {
        const fetcher = results();
        const requests = stubUploads(() => uploaded);
        const client = new CraftClient({ endpoints, csrfToken: false }, DEFAULT_LABELS, { headers: { Authorization: 'Bearer abc', 'X-Comments-Profile': 'cross-origin-member' } });

        vi.stubGlobal('fetch', fetcher);
        await client.searchMentions('x');
        await client.searchElements('x');
        await client.uploadAsset(new File(['x'], 'x.png'));

        for (const call of fetcher.mock.calls) {
            expect(call[1].headers).toMatchObject({ Authorization: 'Bearer abc', 'X-Comments-Profile': 'cross-origin-member', Accept: 'application/json', 'Content-Type': 'application/json' });
        }

        expect(requests[0].headers).toMatchObject({ Authorization: 'Bearer abc', 'X-Comments-Profile': 'cross-origin-member', Accept: 'application/json' });
    });

    it('reads a headers function before every request, so a token can change', async () => {
        const fetcher = results();
        const requests = stubUploads(() => uploaded);
        let token = 0;
        const headers = vi.fn(async () => ({ Authorization: `Bearer ${++token}` }));
        const client = new CraftClient({ endpoints, csrfToken: false }, DEFAULT_LABELS, { headers });

        vi.stubGlobal('fetch', fetcher);
        await client.searchMentions('a');
        await client.searchMentions('b');
        await client.uploadAsset(new File(['x'], 'x.png'));

        expect(headers).toHaveBeenCalledTimes(3);
        expect(fetcher.mock.calls.map((call) => call[1].headers.Authorization)).toEqual(['Bearer 1', 'Bearer 2']);
        expect(requests[0].headers.Authorization).toBe('Bearer 3');
    });

    it('keeps Editor’s own headers over the host’s', async () => {
        const fetcher = results();
        const requests = stubUploads(() => uploaded);
        const client = new CraftClient({ endpoints, csrfToken: 'real', csrfTokenName: 'CRAFT_CSRF_TOKEN' }, DEFAULT_LABELS, {
            headers: { accept: 'text/html', 'content-type': 'text/plain', 'x-csrf-token': 'stale', 'X-Other': 'kept' },
        });

        vi.stubGlobal('fetch', fetcher);
        await client.searchMentions('x');
        await client.uploadAsset(new File(['x'], 'x.png'));

        expect(fetcher.mock.calls[0][1].headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': 'real', 'X-Other': 'kept' });
        // A multipart body needs the browser's own Content-Type, with its boundary.
        expect(requests[0].headers).toEqual({ Accept: 'application/json', 'X-CSRF-Token': 'real', 'X-Other': 'kept' });
    });

    it.each([
        [undefined, 'same-origin', false],
        ['same-origin', 'same-origin', false],
        ['include', 'include', true],
        ['omit', 'omit', false],
    ] as const)('sends credentials %s as fetch %s and XHR withCredentials %s', async (credentials, mode, withCredentials) => {
        const fetcher = results();
        const requests = stubUploads(() => uploaded);
        const client = new CraftClient({ endpoints, csrfToken: false }, DEFAULT_LABELS, credentials ? { credentials } : {});

        vi.stubGlobal('fetch', fetcher);
        await client.searchMentions('x');
        await client.uploadAsset(new File(['x'], 'x.png'));

        expect(fetcher.mock.calls[0][1].credentials).toBe(mode);
        expect(requests[0].withCredentials).toBe(withCredentials);
    });

    it('refuses an unknown credentials mode as a setup mistake', async () => {
        const fetcher = results();
        const client = new CraftClient({ endpoints, csrfToken: false }, DEFAULT_LABELS, { credentials: 'always' as RequestCredentials });

        vi.stubGlobal('fetch', fetcher);

        await expect(client.searchMentions('x')).rejects.toThrow(EditorSetupError);
        await expect(client.uploadAsset(new File(['x'], 'x.png'))).rejects.toThrow(EditorSetupError);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('reports a headers function that fails as a connection problem, without sending', async () => {
        const fetcher = results();
        const requests = stubUploads(() => uploaded);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const client = new CraftClient({ endpoints, csrfToken: false }, DEFAULT_LABELS, { headers: async () => { throw new Error('token endpoint down'); } });

        vi.stubGlobal('fetch', fetcher);

        await expect(client.searchMentions('x')).rejects.toThrow(DEFAULT_LABELS.connectionFailed);
        await expect(client.uploadAsset(new File(['x'], 'x.png'))).rejects.toThrow(DEFAULT_LABELS.connectionFailed);
        expect(fetcher).not.toHaveBeenCalled();
        expect(requests).toHaveLength(0);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('refuses an invalid header name or value as a setup mistake', async () => {
        const fetcher = results();

        vi.stubGlobal('fetch', fetcher);

        await expect(new CraftClient({ endpoints, csrfToken: false }, DEFAULT_LABELS, { headers: { 'Bad Name': 'x' } }).searchMentions('x')).rejects.toThrow(EditorSetupError);
        await expect(new CraftClient({ endpoints, csrfToken: false }, DEFAULT_LABELS, { headers: { Authorization: 'Bearer a\r\nX-Injected: 1' } }).searchMentions('x')).rejects.toThrow(EditorSetupError);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('refuses headers that aren’t an object', async () => {
        vi.stubGlobal('fetch', results());

        const client = new CraftClient({ endpoints, csrfToken: false }, DEFAULT_LABELS, { headers: (() => 'Bearer abc') as unknown as () => Record<string, string> });

        await expect(client.searchMentions('x')).rejects.toThrow(EditorSetupError);
    });

    it('reaches the client from new Editor() and keeps its default when left out', () => {
        expect(normalizeOptions({}).request).toEqual({});
        expect(normalizeOptions({ request: { credentials: 'include' } }).request).toEqual({ credentials: 'include' });
    });

    it('sends the editor’s request option with a pasted image’s upload', async () => {
        const requests = stubUploads(() => uploaded);
        const { editor } = mount({
            features: { image: true },
            craft: { endpoints, csrfToken: false },
            request: { headers: () => ({ Authorization: 'Bearer pasted' }), credentials: 'include' },
        });
        const event = new Event('paste', { bubbles: true, cancelable: true });

        Object.defineProperty(event, 'clipboardData', { value: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] } });
        editor.tiptap.view.dom.dispatchEvent(event);

        await vi.waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0].headers.Authorization).toBe('Bearer pasted');
        expect(requests[0].withCredentials).toBe(true);
    });

    it('merges the element’s request option from data-options and the property', () => {
        registerVerbbEditorInputElement();

        const input = document.createElement('verbb-editor-input');
        const headers = () => ({ Authorization: 'Bearer element' });

        input.setAttribute('data-options', JSON.stringify({ request: { credentials: 'include' } }));
        input.options = { request: { headers } };

        expect(input.options.request).toEqual({ credentials: 'include', headers });
        document.body.append(input);
        expect(input.editor).not.toBeNull();
    });

    it('keeps optional result details only when they are safe', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [
            { id: 1, type: 'u', label: 'A', description: 'Author', imageUrl: '/a.png' },
            { id: 2, type: 'u', label: 'B', description: 3, imageUrl: 'javascript:alert(1)' },
        ] }) }));

        expect(await new CraftClient({ endpoints, csrfToken: false }).searchMentions('')).toEqual([
            { id: 1, type: 'u', label: 'A', description: 'Author', imageUrl: '/a.png' },
            { id: 2, type: 'u', label: 'B' },
        ]);
    });
});

describe('web component', () => {
    registerVerbbEditorElement();

    function element(attributes: Record<string, string> = {}): VerbbEditorElement {
        const component = document.createElement('verbb-editor');

        Object.entries(attributes).forEach(([name, value]) => component.setAttribute(name, value));
        document.body.append(component);

        return component;
    }

    it.each(['name', 'form', 'disabled', 'readonly', 'required'])('keeps the same editor when %s changes', (attribute) => {
        const component = element();
        const editor = component.editor;
        const updates = vi.fn();

        component.addEventListener('editor-update', updates);
        component.setAttribute(attribute, attribute === 'form' ? 'other' : 'x');

        expect(component.editor).toBe(editor);
        expect(updates).not.toHaveBeenCalled();
    });

    it('updates the placeholder in place and only remounts for a preset', () => {
        const component = element({ placeholder: 'First' });
        const editor = component.editor;
        const updates = vi.fn();

        component.addEventListener('editor-update', updates);
        component.editor?.setContent('Keep me');
        updates.mockClear();

        component.setAttribute('placeholder', 'Second');
        expect(component.editor).toBe(editor);

        component.setAttribute('preset', 'minimal');
        expect(component.editor).not.toBe(editor);
        expect(component.editor?.getText()).toBe('Keep me');
        expect(updates).not.toHaveBeenCalled();
    });

    it('takes a value set before connection as its baseline', () => {
        const component = document.createElement('verbb-editor');

        component.value = 'Saved';
        document.body.append(component);

        expect(component.editor?.getText()).toBe('Saved');
        expect(component.editor?.isDirty()).toBe(false);

        component.editor?.setContent('Changed');
        component.formResetCallback();
        expect(component.editor?.getText()).toBe('Saved');
    });

    it('takes a property set before the element was upgraded', () => {
        const tag = 'verbb-editor-late';
        const component = document.createElement(tag) as VerbbEditorElement;

        (component as unknown as { value: string }).value = 'Early';
        document.body.append(component);
        registerVerbbEditorElement(tag);

        expect(component.editor?.getText()).toBe('Early');
    });

    it('registers under a second tag name without throwing', () => {
        expect(() => registerVerbbEditorElement('verbb-editor-second')).not.toThrow();
        expect(document.createElement('verbb-editor-second')).toBeInstanceOf(VerbbEditorElement);
    });

    it('serializes an empty document as an empty string', () => {
        const component = element();

        expect(component.value).toBe('');
        component.editor?.setContent('Words');
        expect(JSON.parse(component.value)).toEqual([paragraph('Words')]);
    });

    it('passes host naming attributes to the textbox', () => {
        const component = element({ 'aria-label': 'Your message' });
        const textbox = component.editor?.tiptap.view.dom;

        expect(textbox?.getAttribute('aria-label')).toBe('Your message');

        component.setAttribute('aria-label', 'Changed');
        expect(textbox?.getAttribute('aria-label')).toBe('Changed');

        component.removeAttribute('aria-label');
        component.setAttribute('aria-labelledby', 'heading');
        expect(textbox?.getAttribute('aria-labelledby')).toBe('heading');
        expect(textbox?.hasAttribute('aria-label')).toBe(false);
    });

    it('marks the textbox required and read-only', () => {
        const component = element({ required: '', readonly: '' });
        const textbox = component.editor?.tiptap.view.dom;

        expect(textbox?.getAttribute('aria-required')).toBe('true');
        expect(textbox?.getAttribute('aria-readonly')).toBe('true');

        component.removeAttribute('readonly');
        expect(textbox?.getAttribute('aria-readonly')).toBe('false');
    });

    it('focuses the editor through the host', () => {
        const component = element();
        const focus = vi.spyOn(component.editor!, 'focus');

        component.focus();
        expect(focus).toHaveBeenCalled();
    });
});

describe('public API', () => {
    it('exposes only the ruled names', async () => {
        const api = await import('../src');

        expect(Object.keys(api).sort()).toEqual(['Editor', 'Tiptap', 'VerbbEditorElement', 'VerbbEditorInputElement', 'loadFeatures', 'registerVerbbEditorElement', 'registerVerbbEditorInputElement']);
    });
});

describe('history', () => {
    it('does not let undo reach past the loaded document', () => {
        const { editor } = mount({ content: [paragraph('Loaded')] });

        expect(editor.tiptap.can().undo()).toBe(false);

        editor.setContent('Replaced');
        expect(editor.tiptap.can().undo()).toBe(false);
    });

    it('clears history on reset', () => {
        const { editor } = mount({ content: [paragraph('Loaded')] });

        editor.tiptap.commands.insertContent('typed');
        expect(editor.tiptap.can().undo()).toBe(true);

        editor.reset();
        expect(editor.tiptap.can().undo()).toBe(false);
        expect(editor.getText()).toBe('Loaded');
    });

    it('can import HTML as a clean baseline', () => {
        const { editor } = mount();

        editor.importHTML('<p>Saved</p>', { baseline: true });
        expect(editor.isDirty()).toBe(false);
        expect(editor.tiptap.can().undo()).toBe(false);

        editor.importHTML('<p>Changed</p>');
        expect(editor.isDirty()).toBe(true);
    });
});
