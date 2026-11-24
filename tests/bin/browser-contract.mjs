import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dom = new JSDOM('<div id="editor"></div><div id="second"></div>', { url: 'https://editor.test', pretendToBeVisual: true });

for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'customElements', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
}

const { Node: TiptapNode } = await import('@tiptap/core');

const Callout = TiptapNode.create({
    name: 'callout',
    group: 'block',
    content: 'block+',
    addAttributes: () => ({ tone: { default: 'info', parseHTML: (element) => element.getAttribute('data-tone') } }),
    parseHTML: () => [{ tag: 'section[data-tone]' }],
    renderHTML: ({ node }) => ['section', { 'data-tone': node.attrs.tone }, 0],
});

const { Editor } = await import('../../packages/editor/dist/index.js');

const features = { craftLink: true, mention: true, image: true, attachment: true };
const editor = new Editor('#editor', {
    content: JSON.parse(readFileSync(`${root}/tests/fixtures/documents/structured-authoring.json`, 'utf8')),
    extensions: [Callout],
    preset: 'full',
    features,
});

// Content that lands differently when features are off. Both sides must agree on the result.
const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const fitting = [
    { features: {}, content: [paragraph('Intro'), { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] }, paragraph('After')] },
    { features: {}, content: [{ type: 'blockquote', content: [paragraph('Quote A'), paragraph('Quote B')] }, { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('One')] }] }] },
    { features: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi ' }, { type: 'mention', attrs: { id: 1, type: 'user', label: 'Alice' } }, { type: 'text', text: ' ok' }] }, { type: 'attachment', attrs: { id: 2 } }] },
    { features: { headings: [2, 3], lists: true, blockquote: true }, content: [{ type: 'heading', attrs: { level: 9 }, content: [{ type: 'text', text: 'Deep' }] }, { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'High' }] }] },
    { features: { lists: true, blockquote: true }, content: [{ type: 'listItem', content: [paragraph('Orphan')] }, { type: 'text', text: 'Root' }, { type: 'paragraph', content: [paragraph('Nested')] }, { type: 'bulletList', content: [paragraph('Bare')] }] },
];

const strings = ['123', 'true', 'null', '[1,2]', '[]', '{"a":1}', 'use <b> for bold', 'first\nsecond', JSON.stringify([paragraph('Doc')]), JSON.stringify({ type: 'doc', content: [paragraph('Doc')] })];

const preset = (document) => ({ preset: 'minimal', features: { bold: false, italic: false, ...document.features } });

try {
    editor.tiptap.commands.insertContentAt(editor.tiptap.state.doc.content.size, { type: 'callout', attrs: { tone: 'warning' }, content: [paragraph('Custom content')] });

    const before = editor.getJSON();
    const php = spawnSync(process.env.PHP_BINARY ?? 'php', [`${root}/tests/bin/document-roundtrip.php`], { input: JSON.stringify({ document: before, fitting, strings }), encoding: 'utf8' });

    assert.equal(php.status, 0, php.stderr || php.stdout);

    const result = JSON.parse(php.stdout);

    // What the browser submits is exactly what the server stores, apart from null attributes.
    const withoutNulls = (value) => JSON.parse(JSON.stringify(value, (key, item) => (item === null || item === '' ? undefined : item)));
    assert.deepEqual(withoutNulls(result.stored), withoutNulls(before), 'The browser must already submit reference-only documents.');

    // The server's resolved document displays in the browser and submits the same references.
    editor.reset(result.resolved);
    assert.deepEqual(withoutNulls(editor.getJSON()), withoutNulls(before), 'Resolved content must round-trip through getJSON().');
    assert.equal(editor.isDirty(), false, 'Resolved content must not start dirty.');
    assert.equal(editor.getText(), result.text, 'Both sides must produce the same plain text.');
    assert.equal(editor.getTextLength(), result.textLength, 'Both sides must count the same text length for limits.');

    // Rendered HTML imports back to the same references.
    editor.importHTML(result.html);
    assert.deepEqual(withoutNulls(editor.getJSON()), withoutNulls(before), 'Browser JSON → PHP HTML → browser must preserve formatting and structured identities.');

    assert.match(result.html, /<section data-tone="warning"><p>Custom content<\/p><\/section>/);
    assert.match(result.html, /href="\/entry"/);
    assert.match(result.html, /src="\/image\.png"/);
    assert.match(result.html, /Paper &lt;b&gt;1&lt;\/b&gt;\.pdf<\/a>/);
    assert.doesNotMatch(result.contextFree, /data-mention-id|data-craft-link-id|\/entry|\/image\.png|\/file\.pdf/);
    assert.equal(result.imported[1].content[0].marks[0].attrs.id, 7);
    assert.equal(result.imported[1].content[1].attrs.id, 4);
    // Media follows the text, because the editor keeps it in its uploads tray.
    const importedImage = result.imported.find((node) => node.type === 'editorAsset');
    const importedAttachment = result.imported.find((node) => node.type === 'attachment');

    assert.equal(importedImage.attrs.id, 9);
    assert.equal(importedAttachment.attrs.id, 10);
    assert.equal(importedAttachment.attrs.mimeType, 'application/pdf');
    assert.deepEqual(before.slice(-2).map((node) => node.type), ['editorAsset', 'attachment']);

    // Both sides fit disabled and invalid content to the same result.
    const second = dom.window.document.querySelector('#second');

    fitting.forEach((document, index) => {
        const fitted = new Editor(second, { ...preset(document), content: document.content });

        assert.deepEqual(withoutNulls(mergeText(result.fitted[index].value)), withoutNulls(fitted.getJSON()), `Fitting ${index} differs between PHP and the browser.`);
        assert.equal(fitted.getText(), result.fitted[index].text, `Fitted text ${index} differs between PHP and the browser.`);
        fitted.destroy();
    });

    // Both sides read the same strings as documents and as literal text.
    strings.forEach((value, index) => {
        const literal = new Editor(second, { content: value });

        assert.deepEqual(withoutNulls(result.strings[index]), withoutNulls(literal.getJSON()), `String ${value} differs between PHP and the browser.`);
        literal.destroy();
    });

    console.log('PASS: browser JSON → PHP store/resolve/HTML/plain text → browser JSON, feature fitting and string rules agree on both sides.');
} finally {
    editor.destroy();
    dom.window.close();
}

// ProseMirror joins adjacent text with the same marks when it loads a document; PHP keeps them apart.
function mergeText(nodes) {
    return nodes.map((node) => (node.content ? { ...node, content: mergeText(node.content) } : node)).reduce((merged, node) => {
        const last = merged[merged.length - 1];

        if (last?.type === 'text' && node.type === 'text' && JSON.stringify(last.marks) === JSON.stringify(node.marks)) {
            last.text += node.text;
        } else {
            merged.push({ ...node });
        }

        return merged;
    }, []);
}
