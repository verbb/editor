import type { EditorFeatures } from '../types';

export const PRESETS: Record<'minimal' | 'standard' | 'full', EditorFeatures> = {
    minimal: {
        bold: true,
        italic: true,
    },
    standard: {
        bold: true,
        italic: true,
        strike: true,
        lists: true,
        blockquote: true,
        code: true,
        link: true,
    },
    full: {
        bold: true,
        italic: true,
        strike: true,
        underline: true,
        headings: [2, 3],
        lists: true,
        blockquote: true,
        code: true,
        link: true,
    },
};
