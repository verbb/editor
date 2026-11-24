import { Editor, registerVerbbEditorElement, registerVerbbEditorInputElement } from '@verbb/editor';
import '@verbb/editor/styles';

const sample = [{ type: 'paragraph', content: [{ type: 'text', text: 'Try formatting, links and mentions.' }] }];
const light = new Editor('#editor-light', {
    theme: 'light', preset: 'full', content: sample,
    craft: {
        context: 'playground.authoring',
        csrfToken: false,
        endpoints: {
            mentions: '/actions/verbb-editor/mentions/search',
            elements: '/actions/verbb-editor/elements/search',
            upload: '/actions/verbb-editor/assets/upload',
        },
    },
    features: { craftLink: true, mention: true, image: true, attachment: true },
    placeholder: 'Write something…',
});
const dark = new Editor('#editor-dark', { theme: 'dark', preset: 'full', content: sample });
const none = new Editor('#editor-none', { theme: 'none', content: sample });
registerVerbbEditorInputElement();
registerVerbbEditorElement();
const form = document.querySelector<HTMLFormElement>('#example-form')!;
form.addEventListener('submit', (event) => {
    event.preventDefault();
    document.querySelector('#form-result')!.textContent = String(new FormData(form).get('body'));
});
// Expose demo instances for inspecting the canonical document while trying the controls.
Object.assign(window, { playgroundEditors: { light, dark, none } });
