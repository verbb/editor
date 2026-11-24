import { afterEach, describe, expect, it, vi } from 'vitest';

import { Editor, registerVerbbEditorElement, registerVerbbEditorInputElement, type VerbbEditorElement } from '../src';
import { stubUploads } from './xhr';

registerVerbbEditorElement();
registerVerbbEditorInputElement();

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const craft = { context: 'a', csrfToken: false as const, endpoints: { upload: '/u', mentions: '/m', elements: '/e' } };

afterEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

function editorElement(markup = '', attributes: Record<string, string> = {}, inForm = true): VerbbEditorElement {
    const element = document.createElement('verbb-editor');

    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    element.innerHTML = markup;

    if (inForm) {
        const form = document.createElement('form');

        form.append(element);
        document.body.append(form);
    } else {
        document.body.append(element);
    }

    return element;
}

function mount(options: ConstructorParameters<typeof Editor>[1] = {}) {
    const host = document.createElement('div');

    document.body.append(host);

    return { editor: new Editor(host, options), host };
}

const commands = (scope: ParentNode, selector = '.verbb-editor__toolbar [data-command]') => [...scope.querySelectorAll<HTMLElement>(selector)].map((button) => button.dataset.command);

describe('toolbar', () => {
    it('puts the common controls on the bar and the rest under More', () => {
        const { host } = mount({ preset: 'full', craft, features: { mention: true, image: true, attachment: true } });

        expect(commands(host)).toEqual(['bold', 'italic', 'link', 'bulletList', 'blockquote', 'mention', 'attach', 'more']);

        host.querySelector<HTMLButtonElement>('[data-command="more"]')!.click();

        expect(commands(host, '.verbb-editor__menu [data-command]')).toEqual(['underline', 'strike', 'code', 'heading-2', 'heading-3', 'orderedList', 'undo', 'redo', 'help']);
        expect(host.querySelector('[data-command="more"]')?.getAttribute('aria-expanded')).toBe('true');
    });

    it('lets a host choose the bar, and names each control with its shortcut', () => {
        const { host } = mount({ preset: 'full', toolbar: ['heading', 'bold', 'orderedList'] });
        const bold = host.querySelector<HTMLElement>('[data-command="bold"]')!;

        expect(commands(host)).toEqual(['heading-2', 'heading-3', 'bold', 'orderedList', 'more']);
        expect(bold.getAttribute('aria-label')).toBe('Bold');
        expect(bold.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+B$/);
        expect(bold.dataset.keys).toBeTruthy();
    });

    it('leaves the toolbar out when `toolbar` is false, for plain writing', () => {
        const none = { bold: false, italic: false, strike: false, lists: false, blockquote: false, code: false, link: false };
        const element = editorElement('', { 'submit-label': 'Reply', 'data-options': JSON.stringify({ toolbar: false, features: none }) });
        const { host } = mount({ toolbar: false });

        expect(element.querySelector('.verbb-editor__toolbar')).toBeNull();
        expect(element.querySelector('.verbb-editor__foot .verbb-editor__submit')).not.toBeNull();
        expect(host.querySelector('.verbb-editor__toolbar')).toBeNull();
        expect(host.querySelector('[data-command="more"]')).toBeNull();

        // With every feature off the schema has no marks, so text comes back exactly as written.
        element.editor!.tiptap.commands.insertContent('**hi**');
        expect(element.editor!.getText()).toBe('**hi**');
        expect(element.editor!.tiptap.schema.marks.bold).toBeUndefined();
    });

    it('names the formatting help tables with captions, so the help adds no headings to the page', () => {
        const { host } = mount({ preset: 'full' });

        host.querySelector<HTMLButtonElement>('[data-command="more"]')!.click();
        host.querySelector<HTMLButtonElement>('.verbb-editor__menu [data-command="help"]')!.click();

        const help = host.querySelector('[role="dialog"]')!;

        expect([...help.querySelectorAll('table > caption')].map((caption) => caption.textContent)).toEqual(['Shortcuts', 'Markdown works too']);
        expect(help.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    });

    it('translates the "or" between the list markers in formatting help', () => {
        const { host } = mount({ preset: 'full', labels: { either: '{first} ou {second}' } });

        host.querySelector<HTMLButtonElement>('[data-command="more"]')!.click();
        host.querySelector<HTMLButtonElement>('.verbb-editor__menu [data-command="help"]')!.click();

        expect([...host.querySelectorAll('.verbb-editor__help td')].map((cell) => cell.textContent)).toContain('- ou *');
    });

    it('marks icons that point along the line to flip in right-to-left text, and leaves the rest', () => {
        const { host } = mount({ preset: 'full' });
        const mirrored = (command: string) => host.querySelector(`[data-command="${command}"] svg`)!.classList.contains('verbb-editor__icon--mirror');

        expect(mirrored('bulletList')).toBe(true);
        expect(mirrored('blockquote')).toBe(true);
        expect(mirrored('bold')).toBe(false);
        expect(mirrored('link')).toBe(false);
    });

    it('offers no link, mention or attach control without what each needs', () => {
        const { host } = mount({ preset: 'minimal', features: { mention: true, image: true, craftLink: true } });

        expect(commands(host)).toEqual(['bold', 'italic', 'more']);
    });

    it('labels the attach control for photos when only images are allowed', () => {
        const { host } = mount({ craft, features: { image: true } });

        expect(host.querySelector('[data-command="attach"]')?.getAttribute('aria-label')).toBe('Add photos');
    });
});

describe('tray', () => {
    it('refuses files past the per-document count before uploading', () => {
        const requests = stubUploads(() => new Promise(() => {}));
        const { editor, host } = mount({ craft: { ...craft, uploads: { maxImages: 1 } }, features: { image: true } });
        const paste = (name: string) => {
            const event = new Event('paste', { bubbles: true, cancelable: true });

            Object.defineProperty(event, 'clipboardData', { value: { files: [new File(['x'], name, { type: 'image/png' })] } });
            editor.tiptap.view.dom.dispatchEvent(event);
        };

        paste('one.png');
        paste('two.png');

        expect(requests).toHaveLength(1);
        expect(host.querySelector('.verbb-editor__notice')?.textContent).toContain('You can add up to 1 photo.');
    });

    it('edits alt text in place and submits it', async () => {
        const { editor, host } = mount({ features: { image: true }, content: [{ type: 'editorAsset', attrs: { id: 4, src: '/a.png', alt: '' } }] });
        const update = vi.fn();

        editor.tiptap.on('update', update);
        host.querySelector<HTMLButtonElement>('[data-tray="alt"]')!.click();

        const field = host.querySelector<HTMLTextAreaElement>('.verbb-editor__alt textarea')!;

        field.value = 'A ridge at dawn';
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

        expect(editor.getJSON()).toEqual([{ type: 'editorAsset', attrs: { id: 4, alt: 'A ridge at dawn' } }]);
        expect(editor.isDirty()).toBe(true);
        expect(host.querySelector('[data-tray="alt"]')?.getAttribute('aria-label')).toBe('Edit alt text for A ridge at dawn');
    });

    it('removes an item without deleting anything on the server', () => {
        const { editor, host } = mount({ features: { attachment: true }, content: [paragraph('Hi'), { type: 'attachment', attrs: { id: 4, filename: 'a.pdf' } }] });

        host.querySelector<HTMLButtonElement>('[aria-label="Remove a.pdf"]')!.click();

        expect(editor.getJSON()).toEqual([paragraph('Hi')]);
    });
});

describe('toolbar position', () => {
    const before = (first: Element | null, second: Element | null) => Boolean(first && second && first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

    it('puts the toolbar in the footer by default, and above the text when asked', () => {
        const bottom = mount().host;
        const top = mount({ toolbarPosition: 'top' }).host;

        expect(bottom.querySelector('.verbb-editor__foot .verbb-editor__toolbar')).not.toBeNull();
        expect(top.querySelector('.verbb-editor__tools .verbb-editor__toolbar')).not.toBeNull();
        expect(before(top.querySelector('.verbb-editor__tools'), top.querySelector('.verbb-editor__body'))).toBe(true);
        expect(top.querySelector('.verbb-editor')?.classList.contains('verbb-editor--toolbar-top')).toBe(true);
    });

    it('keeps a bottom toolbar beside Post in a frame without fields', () => {
        const element = editorElement();

        expect(element.querySelector('.verbb-editor__foot .verbb-editor__toolbar')).not.toBeNull();
        expect(element.querySelector('.verbb-editor')?.classList.contains('has-fields')).toBe(false);
    });

    it('keeps the toolbar with the text when fields sit between the text and Post', () => {
        const element = editorElement('<div slot="above">Rating</div><div slot="footer">Photo</div>');
        const box = element.querySelector('.verbb-editor__box');

        expect(element.querySelector('.verbb-editor')?.classList.contains('has-fields')).toBe(true);
        expect(box?.querySelector('.verbb-editor__body')).not.toBeNull();
        expect(box?.querySelector('.verbb-editor__tools .verbb-editor__toolbar')).not.toBeNull();
        expect(element.querySelector('.verbb-editor__foot .verbb-editor__toolbar')).toBeNull();
        expect(element.querySelector('.verbb-editor__above')?.textContent).toBe('Rating');
        // Rating, then the text and its toolbar, then the fields after it, then Post.
        expect(before(element.querySelector('.verbb-editor__above'), box)).toBe(true);
        expect(before(box, element.querySelector('.verbb-editor__extra'))).toBe(true);
        expect(before(element.querySelector('.verbb-editor__extra'), element.querySelector('.verbb-editor__foot'))).toBe(true);
    });

    it('moves a bottom toolbar into the box when fields arrive later', async () => {
        const element = editorElement();
        const fields = document.createElement('div');

        fields.slot = 'footer';
        fields.textContent = 'Photo';
        element.append(fields);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(element.querySelector('.verbb-editor__box .verbb-editor__toolbar')).not.toBeNull();
    });

    it('keeps a top toolbar above the text in a frame', () => {
        const element = editorElement('<div slot="footer">Photo</div>');

        element.options = { toolbarPosition: 'top' };

        const box = element.querySelector('.verbb-editor__box');

        expect(box?.firstElementChild?.classList.contains('verbb-editor__tools')).toBe(true);
        expect(before(box?.querySelector('.verbb-editor__toolbar') ?? null, box?.querySelector('.verbb-editor__body') ?? null)).toBe(true);
    });
});

describe('<verbb-editor>', () => {
    it('moves slotted content into its frame', () => {
        const element = editorElement('<span slot="header">Replying to Alex</span><button slot="actions" type="button">Cancel</button><ul slot="footer"><li>file.zip</li></ul>', { 'submit-label': 'Reply' });

        expect(element.querySelector('.verbb-editor__head')?.textContent).toBe('Replying to Alex');
        expect(element.querySelector('.verbb-editor__actions')?.textContent).toContain('Cancel');
        expect(element.querySelector('.verbb-editor__actions .verbb-editor__submit')?.getAttribute('aria-label')).toBe('Reply');
        expect(element.querySelector('.verbb-editor__extra')?.textContent).toBe('file.zip');
    });

    it('takes slotted content added later', async () => {
        const element = editorElement();
        const header = document.createElement('span');

        header.slot = 'header';
        header.textContent = 'Later';
        element.append(header);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(element.querySelector('.verbb-editor__head')?.textContent).toBe('Later');
    });

    it('puts actions added later before the Post button', async () => {
        const element = editorElement('', { 'submit-label': 'Reply' });
        const cancel = document.createElement('button');

        cancel.slot = 'actions';
        cancel.textContent = 'Cancel';
        element.append(cancel);
        await new Promise((resolve) => setTimeout(resolve, 0));

        const actions = element.querySelector('.verbb-editor__actions')!;

        expect(actions.firstElementChild).toBe(cancel);
        expect(actions.lastElementChild?.classList.contains('verbb-editor__submit')).toBe(true);
    });

    it('shows who a reply is to, ahead of the header slot, and follows the attribute', () => {
        const element = editorElement('<span slot="header">Posting as Jordan</span>', { 'reply-to': 'Alex Morgan' });
        const reply = element.querySelector<HTMLElement>('.verbb-editor__reply')!;

        expect(reply.hidden).toBe(false);
        expect(reply.textContent).toBe('Replying to Alex Morgan');
        expect(reply.querySelector('b')?.textContent).toBe('Alex Morgan');
        expect(reply.querySelector('button')?.getAttribute('aria-label')).toBe('Cancel reply');
        expect(element.querySelector('.verbb-editor__head')?.firstElementChild).toBe(reply);

        element.setAttribute('reply-to', 'Priya');
        expect(reply.textContent).toBe('Replying to Priya');

        element.removeAttribute('reply-to');
        expect(reply.hidden).toBe(true);
        expect(element.querySelector<HTMLElement>('.verbb-editor__head')?.hidden).toBe(false);
    });

    it('hides the header when there is no reply and nothing slotted', () => {
        const element = editorElement();

        expect(element.querySelector<HTMLElement>('.verbb-editor__head')?.hidden).toBe(true);

        element.setAttribute('reply-to', 'Alex');
        expect(element.querySelector<HTMLElement>('.verbb-editor__head')?.hidden).toBe(false);
    });

    it('cancels a reply with a cancelable editor-reply-cancel event', () => {
        const element = editorElement('', { 'reply-to': 'Alex' });
        const events: CustomEvent[] = [];

        element.addEventListener('editor-reply-cancel', (event) => events.push(event as CustomEvent));
        element.querySelector<HTMLButtonElement>('.verbb-editor__reply button')!.click();

        expect(events[0]?.detail).toEqual({ name: 'Alex' });
        expect(element.hasAttribute('reply-to')).toBe(false);
        expect(element.querySelector<HTMLElement>('.verbb-editor__reply')?.hidden).toBe(true);

        element.setAttribute('reply-to', 'Alex');
        element.addEventListener('editor-reply-cancel', (event) => event.preventDefault());
        element.querySelector<HTMLButtonElement>('.verbb-editor__reply button')!.click();

        expect(element.getAttribute('reply-to')).toBe('Alex');
    });

    it('lets a translation put the name anywhere in the reply label', () => {
        const element = editorElement('', { 'reply-to': 'Alex', 'data-options': JSON.stringify({ labels: { replyingTo: 'Antwort an {name} schreiben' } }) });

        expect(element.querySelector('.verbb-editor__reply-text')?.innerHTML).toBe('Antwort an <b>Alex</b> schreiben');
    });

    it('reads options from data-options, with attributes winning', () => {
        const element = editorElement('', { 'data-options': JSON.stringify({ placeholder: 'From options', features: { bold: true }, preset: 'minimal' }), placeholder: 'From attribute' });

        expect(element.options.placeholder).toBe('From attribute');
        expect(element.querySelector('[data-command="bold"]')).not.toBeNull();
    });

    it('holds Post while empty, then fires a cancelable editor-submit before the form submits', () => {
        const element = editorElement('', { 'submit-label': 'Post' });
        const form = element.form!;
        const submit = vi.fn((event: Event) => event.preventDefault());
        const intercept = vi.fn();

        form.addEventListener('submit', submit);
        element.addEventListener('editor-submit', intercept);

        const button = element.querySelector<HTMLButtonElement>('.verbb-editor__submit')!;

        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.dataset.tip).toBe('Write something first.');
        button.click();
        expect(intercept).not.toHaveBeenCalled();

        element.editor!.setContent('Hello');
        expect(button.getAttribute('aria-disabled')).toBe('false');
        button.click();
        expect(intercept).toHaveBeenCalledOnce();
        expect(intercept.mock.calls[0][0].detail.value).toBe(JSON.stringify([paragraph('Hello')]));
        expect(submit).toHaveBeenCalledOnce();

        element.addEventListener('editor-submit', (event) => event.preventDefault(), { once: true });
        element.requestSubmit();
        expect(submit).toHaveBeenCalledOnce();
    });

    it('counts a limit the way the server counts text length', () => {
        const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

        // Three paragraphs of three are 13 characters with the blank lines between them, as the
        // server counts, so they're one over a limit of 12.
        const blocks = editorElement('', { limit: '12', 'submit-label': 'Post' });

        blocks.editor!.setContent([paragraph('Abc'), paragraph('Abc'), paragraph('Abc')]);
        expect(blocks.editor!.getTextLength()).toBe(13);
        expect(blocks.querySelector('.verbb-editor__status')?.textContent).toBe('Too long by 1 character');

        // Each emoji counts once, as PHP's mb_strlen() counts, so this fits a limit of 9.
        const emoji = editorElement('', { limit: '9', 'submit-label': 'Post' });

        emoji.editor!.setContent([paragraph('Party 🎉🎉')]);
        expect(emoji.editor!.getTextLength()).toBe(8);
        expect(emoji.querySelector('.verbb-editor__status')?.textContent).not.toContain('Too long');
    });

    it('counts towards a limit and refuses to submit over it', () => {
        const element = editorElement('', { limit: '10', 'submit-label': 'Post' });

        element.editor!.setContent('Seven c');
        expect(element.querySelector('.verbb-editor__count')?.textContent).toBe('');

        element.editor!.setContent('Nine char');
        expect(element.querySelector('.verbb-editor__count')?.textContent).toContain('1');

        element.editor!.setContent('Twelve chars');
        expect(element.querySelector('.verbb-editor__count')?.textContent).toContain('-2');
        expect(element.querySelector('.verbb-editor__status')?.textContent).toBe('Too long by 2 characters');
        expect(element.querySelector('.verbb-editor__submit')?.getAttribute('aria-disabled')).toBe('true');

        // Form validity needs ElementInternals, which jsdom lacks; the browser suite checks it.
        element.removeAttribute('limit');
        expect(element.querySelector('.verbb-editor__count')?.textContent).toBe('');
        expect(element.querySelector('.verbb-editor__submit')?.getAttribute('aria-disabled')).toBe('false');
    });

    it('goes read-only while busy, and shows a post error with Try again', async () => {
        const element = editorElement('', { 'submit-label': 'Post' });

        element.editor!.setContent('Hi');
        element.setAttribute('busy', '');
        expect(element.editor!.tiptap.isEditable).toBe(false);
        expect(element.querySelector('.verbb-editor__submit')?.textContent).toContain('Posting…');

        element.removeAttribute('busy');
        element.showPostError();
        expect(element.editor!.tiptap.isEditable).toBe(true);
        // The notice is a live region already, so the failure is announced once rather than twice.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(element.querySelector('.verbb-editor > .verbb-editor__sr[role="status"]')?.textContent).toBe('Posting…');

        const notice = element.querySelector('.verbb-editor__notice')!;

        expect(notice.textContent).toContain('Couldn’t post.');

        const intercept = vi.fn((event: Event) => event.preventDefault());

        element.addEventListener('editor-submit', intercept);
        [...notice.querySelectorAll('button')].find((button) => button.textContent === 'Try again')!.click();
        expect(intercept).toHaveBeenCalledOnce();
        expect(notice.textContent).toBe('');
    });

    it('submits on Enter only when asked, and never from inside a list', () => {
        const element = editorElement('', { 'enter-submits': '' });
        const intercept = vi.fn((event: Event) => event.preventDefault());

        element.addEventListener('editor-submit', intercept);
        element.editor!.setContent('Hi');
        element.editor!.tiptap.commands.focus('end');

        const enter = () => element.editor!.tiptap.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

        enter();
        expect(intercept).toHaveBeenCalledOnce();

        element.editor!.setContent([{ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Item')] }] }]);
        element.editor!.tiptap.commands.focus('end');
        enter();
        expect(intercept).toHaveBeenCalledOnce();

        element.removeAttribute('enter-submits');
        element.editor!.setContent('Hi');
        element.editor!.tiptap.commands.focus('end');
        enter();
        expect(intercept).toHaveBeenCalledOnce();
    });

    it('submits with Mod-Enter', () => {
        const element = editorElement();
        const intercept = vi.fn((event: Event) => event.preventDefault());

        element.addEventListener('editor-submit', intercept);
        element.editor!.setContent('Hi');
        element.editor!.tiptap.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));

        expect(intercept).toHaveBeenCalledOnce();
    });

    it('collapses to one line while empty and unfocused', () => {
        const element = editorElement('', { collapsible: '' });

        expect(element.querySelector('.verbb-editor')?.classList.contains('is-collapsed')).toBe(true);

        element.editor!.setContent('Words');
        expect(element.querySelector('.verbb-editor')?.classList.contains('is-collapsed')).toBe(false);
    });

    it('keeps a local draft, restores it with Discard, and forgets it on reset', () => {
        vi.useFakeTimers();

        const first = editorElement('', { 'draft-key': 'reply:1' });

        first.editor!.setContent('Unfinished');
        vi.advanceTimersByTime(900);
        expect(JSON.parse(localStorage.getItem('verbb-editor-draft:reply:1')!).content).toEqual([paragraph('Unfinished')]);
        expect(first.querySelector('.verbb-editor__status')?.textContent).toBe('Draft saved');
        document.body.replaceChildren();

        const second = editorElement('', { 'draft-key': 'reply:1' });

        expect(second.editor!.getText()).toBe('Unfinished');
        expect(second.value).toBe(JSON.stringify([paragraph('Unfinished')]));
        expect(second.querySelector('.verbb-editor__notice')?.textContent).toMatch(/Restored your draft from .+\./);

        [...second.querySelectorAll<HTMLButtonElement>('.verbb-editor__notice button')].find((button) => button.textContent === 'Discard')!.click();
        expect(second.editor!.isEmpty()).toBe(true);
        expect(localStorage.getItem('verbb-editor-draft:reply:1')).toBeNull();

        second.editor!.setContent('Again');
        vi.advanceTimersByTime(900);
        expect(localStorage.getItem('verbb-editor-draft:reply:1')).not.toBeNull();
        second.form!.reset();
        expect(localStorage.getItem('verbb-editor-draft:reply:1')).toBeNull();
    });

    it('drops uploads Craft will have cleaned up from a restored draft, and says so', () => {
        const day = 24 * 60 * 60 * 1000;

        localStorage.setItem('verbb-editor-draft:old', JSON.stringify({
            version: 1,
            savedAt: Date.now() - day,
            content: [paragraph('Text'), { type: 'editorAsset', attrs: { id: 1, alt: '' } }, { type: 'editorAsset', attrs: { id: 2, alt: '' } }],
            uploadTimes: { 1: Date.now() - day - 1000, 2: Date.now() - 1000 },
        }));

        const element = editorElement('', { 'draft-key': 'old', 'data-options': JSON.stringify({ features: { image: true } }) });

        expect(element.json).toEqual([paragraph('Text'), { type: 'editorAsset', attrs: { id: 2, alt: '' } }]);
        expect(element.querySelector('.verbb-editor__notice')?.textContent).toContain('Files older than a day were removed.');
    });

    it('still restores a draft when the page has an invalid language tag', () => {
        document.documentElement.lang = 'en_US';
        localStorage.setItem('verbb-editor-draft:lang', JSON.stringify({ version: 1, savedAt: Date.now() - 120000, content: [paragraph('Kept')], uploadTimes: {} }));

        try {
            const element = editorElement('', { 'draft-key': 'lang' });

            expect(element.editor!.getText()).toBe('Kept');
            expect(element.querySelector('.verbb-editor__notice')?.textContent).toMatch(/Restored your draft from .+\./);
        } finally {
            document.documentElement.lang = '';
        }
    });

    it('forgets the draft when a submission goes ahead', () => {
        localStorage.setItem('verbb-editor-draft:sent', JSON.stringify({ version: 1, savedAt: Date.now(), content: [paragraph('Sending')], uploadTimes: {} }));

        const element = editorElement('', { 'draft-key': 'sent' });
        const event = new Event('submit', { bubbles: true, cancelable: true });

        element.form!.dispatchEvent(event);
        expect(localStorage.getItem('verbb-editor-draft:sent')).toBeNull();
    });

    it('keeps the draft when a host cancels the submission to post it itself', () => {
        localStorage.setItem('verbb-editor-draft:fetch', JSON.stringify({ version: 1, savedAt: Date.now(), content: [paragraph('Posting')], uploadTimes: {} }));

        const element = editorElement('', { 'draft-key': 'fetch' });

        element.form!.addEventListener('submit', (event) => event.preventDefault());
        element.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        expect(localStorage.getItem('verbb-editor-draft:fetch')).not.toBeNull();
    });
});

describe('<verbb-editor-input>', () => {
    it('is the editor input with its toolbar and form value, and no frame', () => {
        const form = document.createElement('form');
        const input = document.createElement('verbb-editor-input');

        input.setAttribute('name', 'body');
        form.append(input);
        document.body.append(form);
        input.editor!.setContent('Hi');

        expect(new FormData(form).get('body')).toBe(JSON.stringify([paragraph('Hi')]));
        expect(input.querySelector('.verbb-editor__toolbar')).not.toBeNull();
        expect(input.querySelector('.verbb-editor__head, .verbb-editor__submit, .verbb-editor__meta')).toBeNull();
    });
});
