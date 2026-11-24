import { normalizeContent } from '../core/document';
import { DEFAULT_FEATURES, DEFAULT_THEME } from './defaults';
import { DEFAULT_LABELS } from './labels';
import { PRESETS } from './presets';

import type {
    EditorGif,
    EditorFeatures,
    EditorOptions,
    ResolvedEditorFeatures,
    ResolvedEditorOptions,
    GifConfig,
} from '../types';

const DEFAULT_PLACEHOLDER = 'Write something…';

function resolveFeatureValue<K extends keyof EditorFeatures>(
    key: K,
    value: EditorFeatures[K] | undefined,
    fallback: EditorFeatures[K] | undefined,
): ResolvedEditorFeatures[K] {
    if (value !== undefined) {
        return value as ResolvedEditorFeatures[K];
    }

    if (fallback !== undefined) {
        return fallback as ResolvedEditorFeatures[K];
    }

    return DEFAULT_FEATURES[key] as ResolvedEditorFeatures[K];
}

function resolveHeadings(headings: EditorFeatures['headings']): false | number[] {
    if (headings === true) {
        return [2, 3];
    }

    if (!Array.isArray(headings)) {
        return false;
    }

    const levels = [...new Set(headings.filter((level) => Number.isInteger(level) && level >= 1 && level <= 6))];

    // An empty list means headings are off, as it does on the server.
    return levels.length ? levels : false;
}

function mergeFeatures(presetFeatures: EditorFeatures, overrides?: EditorFeatures): ResolvedEditorFeatures {
    return {
        bold: resolveFeatureValue('bold', overrides?.bold, presetFeatures.bold),
        italic: resolveFeatureValue('italic', overrides?.italic, presetFeatures.italic),
        strike: resolveFeatureValue('strike', overrides?.strike, presetFeatures.strike),
        underline: resolveFeatureValue('underline', overrides?.underline, presetFeatures.underline),
        headings: resolveHeadings(overrides?.headings ?? presetFeatures.headings),
        lists: resolveFeatureValue('lists', overrides?.lists, presetFeatures.lists),
        blockquote: resolveFeatureValue('blockquote', overrides?.blockquote, presetFeatures.blockquote),
        code: resolveFeatureValue('code', overrides?.code, presetFeatures.code),
        link: resolveFeatureValue('link', overrides?.link, presetFeatures.link),
        craftLink: resolveFeatureValue('craftLink', overrides?.craftLink, presetFeatures.craftLink),
        image: resolveFeatureValue('image', overrides?.image, presetFeatures.image),
        attachment: resolveFeatureValue('attachment', overrides?.attachment, presetFeatures.attachment),
        mention: resolveFeatureValue('mention', overrides?.mention, presetFeatures.mention),
    };
}

/** GIF search needs a key. Anything else turns it off rather than showing a control that can't search. */
function resolveGifs(gifs: EditorOptions['gifs']): GifConfig | false {
    return gifs && typeof gifs === 'object' && typeof gifs.apiKey === 'string' && gifs.apiKey !== '' ? { ...gifs } : false;
}

/** A GIF needs an address; a size that isn't a positive number is unknown. */
export function normalizeGif(gif: unknown): EditorGif | null {
    if (!gif || typeof gif !== 'object' || typeof (gif as EditorGif).url !== 'string' || !(gif as EditorGif).url) return null;

    const size = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
    const { url, width, height } = gif as EditorGif;

    return { url, width: size(width), height: size(height) };
}

export function normalizeOptions(options: EditorOptions = {}): ResolvedEditorOptions {
    const preset = options.preset ?? 'standard';
    const presetFeatures = PRESETS[preset] ?? PRESETS.standard;

    return {
        content: normalizeContent(options.content ?? []),
        theme: options.theme ?? DEFAULT_THEME,
        features: mergeFeatures(presetFeatures, options.features),
        placeholder: options.placeholder ?? DEFAULT_PLACEHOLDER,
        labels: { ...DEFAULT_LABELS, ...options.labels },
        toolbar: options.toolbar === false ? false : Array.isArray(options.toolbar) ? options.toolbar : null,
        toolbarPosition: options.toolbarPosition === 'top' ? 'top' : 'bottom',
        ariaLabel: options.ariaLabel,
        ariaLabelledBy: options.ariaLabelledBy,
        editable: options.editable ?? true,
        craft: options.craft ?? false,
        request: options.request ?? {},
        gifs: resolveGifs(options.gifs),
        gif: normalizeGif(options.gif),
        extensions: options.extensions ?? [],
        onUpdate: options.onUpdate,
        onChange: options.onChange,
        onUploadState: options.onUploadState,
    };
}
