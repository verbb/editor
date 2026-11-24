import type { EditorOptions, VerbbEditorElement } from '@verbb/editor';

import { type DemoSimulation, registerDemo } from './fakeCraft';
import type { Scenario } from './scenarios';

export interface MountedDemo {
    element: VerbbEditorElement;
    destroy: () => void;
}

export interface MountHooks {
    /** Called with the posted document after a successful (pretend) post. */
    onPosted?: (post: { json: unknown; html: string; uploads: number }) => void;
    onUpdate?: (json: unknown) => void;
}

export interface MountOverrides {
    attrs?: Record<string, string | true | null>;
}

/** Per-document limits, as `browserOptions()` sends them from the context's `AssetConfig`. */
const UPLOAD_LIMITS = {
    imageExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    attachmentExtensions: ['pdf', 'txt', 'csv', 'zip', 'docx'],
    maxFileSize: 10 * 1024 * 1024,
    maxImages: 4,
    maxAttachments: 3,
};

/**
 * Mounts an editor the way a Twig host would: a `<verbb-editor>` inside a form, posting through
 * its own request. Editor is imported here rather than at the top, because the element needs the
 * browser and VitePress renders pages on the server first.
 */
export async function mountDemo(
    host: HTMLElement,
    scenario: Scenario,
    simulation: DemoSimulation,
    hooks: MountHooks = {},
    overrides: MountOverrides = {},
): Promise<MountedDemo> {
    const { registerVerbbEditorElement } = await import('@verbb/editor');

    registerVerbbEditorElement();

    const demo = registerDemo(simulation);
    const form = document.createElement('form');
    const element = document.createElement('verbb-editor') as VerbbEditorElement;
    const attrs = { ...scenario.attrs, ...overrides.attrs };

    for (const [name, value] of Object.entries(attrs)) {
        if (value === null) continue;
        element.setAttribute(name, value === true ? '' : value);
    }

    const options: EditorOptions = {
        ...scenario.options,
        craft: { context: 'docs.demo', csrfToken: false, endpoints: demo.endpoints, uploads: UPLOAD_LIMITS },
    };

    if (scenario.content) options.content = scenario.content;

    element.options = options;

    if (scenario.header) {
        const header = document.createElement('span');

        header.slot = 'header';
        header.className = 'editor-demo__header';
        // Static markup from the scenario list, never visitor input.
        header.innerHTML = scenario.header;
        element.append(header);
    }

    // The host's own fields, before and after the text. Static markup from the scenario list.
    for (const [slot, markup] of [['above', scenario.above], ['footer', scenario.footer]] as const) {
        if (!markup) continue;

        const fields = document.createElement('div');

        fields.slot = slot;
        fields.innerHTML = markup;
        element.append(fields);
    }

    if (scenario.cancel) {
        const cancel = document.createElement('button');

        cancel.slot = 'actions';
        cancel.type = 'reset';
        cancel.className = 'verbb-editor__button';
        cancel.textContent = 'Cancel';
        element.append(cancel);
    }

    let timer = 0;

    // The fetch-based host pattern: cancel the submission, show busy, then reset or show the error.
    element.addEventListener('editor-submit', (event) => {
        event.preventDefault();
        element.setAttribute('busy', '');

        timer = window.setTimeout(() => {
            element.removeAttribute('busy');

            if (simulation.postFail) {
                element.showPostError();

                return;
            }

            const json = element.json;
            // Temporary uploads have no public URL until the host saves them, so the HTML
            // preview leaves them out; count them instead.
            const uploads = Array.isArray(json) ? json.filter((node) => node?.type === 'editorAsset').length : 0;

            hooks.onPosted?.({ json, html: element.editor?.getHTML() ?? '', uploads });
            form.reset();
        }, 900);
    });
    element.addEventListener('editor-update', () => hooks.onUpdate?.(element.json));
    form.addEventListener('submit', (event) => event.preventDefault());

    form.append(element);
    host.append(form);
    scenario.setup?.(element);
    hooks.onUpdate?.(element.json);

    return {
        element,
        destroy() {
            window.clearTimeout(timer);
            form.remove();
            demo.release();
        },
    };
}

/** A sample photo, drawn rather than shipped, so the docs carry no image files for it. */
async function samplePhoto(): Promise<File> {
    const canvas = document.createElement('canvas');

    canvas.width = 960;
    canvas.height = 640;

    const context = canvas.getContext('2d')!;
    const sky = context.createLinearGradient(0, 0, 0, 640);

    sky.addColorStop(0, '#9ec5e8');
    sky.addColorStop(1, '#f3d9b1');
    context.fillStyle = sky;
    context.fillRect(0, 0, 960, 640);
    context.fillStyle = '#5b6f5a';
    context.beginPath();
    context.moveTo(0, 520);
    context.lineTo(260, 260);
    context.lineTo(430, 420);
    context.lineTo(620, 200);
    context.lineTo(960, 500);
    context.lineTo(960, 640);
    context.lineTo(0, 640);
    context.fill();

    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/jpeg', 0.85));

    return new File([blob], 'ridge-loop.jpg', { type: 'image/jpeg' });
}

/**
 * Adds a sample file as if it were dropped on the editor. Browsers don't let a page fill a file
 * picker, and dropping is one of the ways people really add files, so this goes through the same path.
 */
export async function addSampleFile(element: HTMLElement, kind: 'photo' | 'file'): Promise<void> {
    const file = kind === 'photo'
        ? await samplePhoto()
        : new File(['Ridge Loop route notes\n'], 'route-notes.pdf', { type: 'application/pdf' });
    const target = element.querySelector('[contenteditable]');

    if (!target) return;

    const transfer = new DataTransfer();

    transfer.items.add(file);
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
}
