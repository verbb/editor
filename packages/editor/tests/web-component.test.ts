import { describe, expect, it } from 'vitest';

import { registerVerbbEditorElement, VerbbEditorElement } from '../src/web-component/register';

describe('web component', () => {
    it('registers and mounts verbb-editor', () => {
        registerVerbbEditorElement('verbb-editor-test');

        const element = document.createElement('verbb-editor-test') as VerbbEditorElement;
        element.setAttribute('theme', 'light');
        element.setAttribute('preset', 'minimal');
        document.body.appendChild(element);

        expect(element.editor).not.toBeNull();
        expect(element.querySelector('.verbb-editor[data-theme="light"]')).not.toBeNull();

        element.remove();
    });
});
