export { Editor } from './Editor';
export { loadFeatures } from './features/load';

export type {
    CraftEndpoints,
    CraftOptions,
    CraftUploadLimits,
    EditorChangeEvent,
    EditorContent,
    EditorFeatures,
    EditorGif,
    EditorLabels,
    EditorOptions,
    EditorPreset,
    EditorRequestHeaders,
    EditorRequestOptions,
    EditorTheme,
    EditorTool,
    EditorToolbarPosition,
    EditorUpdateEvent,
    EditorUploadStateEvent,
    GifConfig,
    GifRating,
} from './types';

export { registerVerbbEditorElement, registerVerbbEditorInputElement, VerbbEditorElement, VerbbEditorInputElement } from './web-component/register';

export * as Tiptap from '@tiptap/core';
