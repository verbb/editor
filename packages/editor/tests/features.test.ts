import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as link from '../src/features/link';
import * as linkTools from '../src/features/link-tools';
import * as mention from '../src/features/mention';
import { provideFeatures, type FeatureName } from '../src/features/registry';
import * as uploads from '../src/features/uploads';
import * as gifs from '../src/gifs/index';
import { Editor, loadFeatures, registerVerbbEditorInputElement } from '../src/public';

import type { VerbbEditorInputElement } from '../src/web-component/VerbbEditorInputElement';

// The Composer bundle's arrangement: each feature arrives later, through a loader.
const modules = { link, linkTools, mention, uploads, gifs };
let calls: FeatureName[] = [];
let failing = new Set<FeatureName>();

function provideLazily(): void {
    const loader = <Name extends FeatureName>(name: Name) => async () => {
        calls.push(name);
        await Promise.resolve();

        if (failing.has(name)) throw new Error(`no ${name}`);

        return modules[name];
    };

    provideFeatures({ link: loader('link'), linkTools: loader('linkTools'), mention: loader('mention'), uploads: loader('uploads'), gifs: loader('gifs') });
}

function input(options: Record<string, unknown>): VerbbEditorInputElement {
    const element = document.createElement('verbb-editor-input') as VerbbEditorInputElement;
    element.options = options;

    return element;
}

registerVerbbEditorInputElement();

beforeEach(() => {
    calls = [];
    failing = new Set();
    provideLazily();
});

afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe('lazily loaded features', () => {
    it('loads only what the features use', async () => {
        await loadFeatures({ preset: 'minimal', features: { mention: true } });
        expect(calls).toEqual(['mention']);

        await loadFeatures({ preset: 'minimal', features: { link: true, image: true } });
        expect(calls).toEqual(['mention', 'link', 'linkTools', 'uploads']);
    });

    it('loads each feature once, however many editors ask at the same time', async () => {
        await Promise.all([loadFeatures({ preset: 'standard' }), loadFeatures({ preset: 'standard' })]);

        expect(calls).toEqual(['link', 'linkTools']);
    });

    it('needs only the Link control for Craft links', async () => {
        await loadFeatures({ preset: 'minimal', features: { craftLink: true } });

        expect(calls).toEqual(['linkTools']);
    });

    it('builds an editor without optional features straight away', () => {
        const host = document.createElement('div');
        const editor = new Editor(host, { preset: 'minimal' });

        expect(editor.tiptap.schema.marks.link).toBeUndefined();
        expect(calls).toEqual([]);
        editor.destroy();
    });

    it('refuses to build an editor without a feature it uses, rather than drop that content', () => {
        expect(() => new Editor(document.createElement('div'), { features: { link: true, mention: true } }))
            .toThrow(/link, linkTools, mention features aren’t loaded/);
    });

    it('creates the editor once its features load', async () => {
        const editor = await Editor.create(document.createElement('div'), {
            preset: 'standard',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] }],
        });

        expect(editor.getHTML()).toContain('href="https://example.com"');
        editor.destroy();
    });

    it('rejects when a feature fails to load, and tries again next time', async () => {
        failing.add('mention');

        await expect(loadFeatures({ preset: 'minimal', features: { mention: true } })).rejects.toThrow('Editor’s mention feature couldn’t be loaded.');

        failing.clear();
        await loadFeatures({ preset: 'minimal', features: { mention: true } });
        expect(calls).toEqual(['mention', 'mention']);
    });
});

describe('elements with lazily loaded features', () => {
    it('mount at once when no feature needs loading', () => {
        const element = input({ preset: 'minimal' });
        document.body.append(element);

        expect(element.editor).not.toBeNull();
        expect(element.hasAttribute('aria-busy')).toBe(false);
    });

    it('wait for their features, then resolve ready and announce it', async () => {
        const element = input({ preset: 'standard' });
        const announced = vi.fn();

        element.addEventListener('editor-ready', announced);
        document.body.append(element);

        expect(element.editor).toBeNull();
        expect(element.getAttribute('aria-busy')).toBe('true');

        const editor = await element.ready;

        expect(editor).toBe(element.editor);
        expect(editor.tiptap.schema.marks.link).toBeDefined();
        expect(element.hasAttribute('aria-busy')).toBe(false);
        expect(announced).toHaveBeenCalledOnce();
    });

    it('keep a value set while waiting', async () => {
        const element = input({ preset: 'standard' });

        document.body.append(element);
        element.value = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Early' }] }]);

        expect((await element.ready).getText()).toBe('Early');
    });

    it('mount at once once a host has loaded their features', async () => {
        await (customElements.get('verbb-editor-input') as typeof VerbbEditorInputElement).loadFeatures({ preset: 'standard' });

        const element = input({ preset: 'standard' });
        document.body.append(element);

        expect(element.editor).not.toBeNull();
    });

    it('never mount once removed while waiting', async () => {
        const element = input({ preset: 'standard' });

        document.body.append(element);
        element.remove();
        await loadFeatures({ preset: 'standard' });
        await Promise.resolve();

        expect(element.editor).toBeNull();
    });

    it('report a feature that fails to load and stay unmounted, then retry when added again', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        failing.add('mention');

        const element = input({ preset: 'minimal', features: { mention: true } });
        const failed = vi.fn();

        element.addEventListener('editor-error', failed);
        document.body.append(element);

        await expect(element.ready).rejects.toThrow('Editor’s mention feature couldn’t be loaded.');
        expect(element.editor).toBeNull();
        expect(element.hasAttribute('aria-busy')).toBe(false);
        expect(failed).toHaveBeenCalledOnce();

        failing.clear();
        element.remove();
        document.body.append(element);

        expect(await element.ready).toBe(element.editor);
    });
});
