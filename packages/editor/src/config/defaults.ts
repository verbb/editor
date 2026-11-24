import type { EditorFeatures } from '../types';

export const DEFAULT_THEME = 'light' as const;

export const DEFAULT_FEATURES: Required<EditorFeatures> = {
    bold: false,
    italic: false,
    strike: false,
    underline: false,
    headings: false,
    lists: false,
    blockquote: false,
    code: false,
    link: false,
    craftLink: false,
    image: false,
    attachment: false,
    mention: false,
};
