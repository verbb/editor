import { afterEach, describe, expect, it } from 'vitest';

import { Editor } from '../src';
import { contentToPlainText, normalizeContent } from '../src/core/document';
import type { EditorContent } from '../src';

const documents = import.meta.glob<Record<string, unknown>[]>('../../../tests/fixtures/documents/*.json', { eager: true, import: 'default' });

function fixture(name: string): Record<string, unknown>[] {
    return structuredClone(documents[`../../../tests/fixtures/documents/${name}.json`]);
}

function semanticallyEquivalent(left: EditorContent, right: EditorContent): boolean {
    return contentToPlainText(left) === contentToPlainText(right);
}

describe('document helpers', () => {
    it('normalises doc wrappers and json strings', () => {
        const content = fixture('basic-rich-text');

        expect(normalizeContent({ type: 'doc', content })).toEqual(normalizeContent(content));
        expect(normalizeContent(JSON.stringify({ type: 'doc', content }))).toEqual(normalizeContent(content));
    });
});

describe('Editor mount API', () => {
    const hosts: HTMLElement[] = [];

    afterEach(() => {
        hosts.splice(0).forEach((host) => host.remove());
    });

    function createHost(): HTMLElement {
        const host = document.createElement('div');
        document.body.appendChild(host);
        hosts.push(host);
        return host;
    }

    it('initialises from canonical fixture content and exposes json/html/text', () => {
        const host = createHost();
        const content = fixture('basic-rich-text');
        const editor = new Editor(host, {
            theme: 'light',
            preset: 'standard',
            content,
        });

        expect(editor.getJSON()).toEqual(normalizeContent(content));
        expect(editor.getHTML()).toContain('Hello');
        expect(editor.getText()).toContain('world');
        expect(host.querySelector('.verbb-editor[data-theme="light"]')).not.toBeNull();

        editor.destroy();
        expect(host.childNodes.length).toBe(0);
    });

    it('supports comments.reply craft context option without requiring network', () => {
        const host = createHost();
        const editor = new Editor(host, {
            craft: { context: 'comments.reply' },
            content: fixture('links'),
        });

        expect(editor.getText()).toContain('Verbb');
        editor.destroy();
    });
});

describe('cross-layer fixture contract', () => {
    const fixtures = ['basic-rich-text', 'nested-lists', 'links', 'mixed-formatting'] as const;

    fixtures.forEach((name) => {
        it(`round-trips ${name} through the browser editor`, () => {
            const host = document.createElement('div');
            document.body.appendChild(host);

            const source = fixture(name);
            const editor = new Editor(host, { content: source, preset: 'standard' });
            const output = editor.getJSON();

            expect(semanticallyEquivalent(output, source)).toBe(true);

            editor.clear();
            editor.setContent(source);
            expect(semanticallyEquivalent(editor.getJSON(), source)).toBe(true);

            editor.destroy();
            host.remove();
        });
    });
});

describe('themes', () => {
    it('applies light and dark themes independently', () => {
        const lightHost = document.createElement('div');
        const darkHost = document.createElement('div');
        document.body.append(lightHost, darkHost);

        const light = new Editor(lightHost, { theme: 'light', content: fixture('basic-rich-text') });
        const dark = new Editor(darkHost, { theme: 'dark', content: fixture('basic-rich-text') });

        expect(lightHost.querySelector('[data-theme="light"]')).not.toBeNull();
        expect(darkHost.querySelector('[data-theme="dark"]')).not.toBeNull();

        light.destroy();
        dark.destroy();
        lightHost.remove();
        darkHost.remove();
    });
});

describe('multiple instances', () => {
    it('mounts isolated editors with independent content', () => {
        const hostA = document.createElement('div');
        const hostB = document.createElement('div');
        document.body.append(hostA, hostB);

        const editorA = new Editor(hostA, { content: fixture('basic-rich-text') });
        const editorB = new Editor(hostB, { content: fixture('links') });

        expect(editorA.id).not.toBe(editorB.id);
        expect(editorA.getText()).toContain('Hello');
        expect(editorB.getText()).toContain('Verbb');
        expect(semanticallyEquivalent(editorA.getJSON(), fixture('basic-rich-text'))).toBe(true);
        expect(semanticallyEquivalent(editorB.getJSON(), fixture('links'))).toBe(true);

        editorA.destroy();
        editorB.destroy();
        hostA.remove();
        hostB.remove();
    });
});
