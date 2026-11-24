// Stroke icons drawn on a 24px grid. They inherit `currentColor`, so host tokens colour them.
const PATHS = {
    bold: '<path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H7zM7 12h7.5a3.5 3.5 0 0 1 0 7H7z"/>',
    italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
    underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4M4 20h16"/>',
    strike: '<path d="M16 5.5A4.5 3.5 0 0 0 12 4c-2.8 0-4.5 1.5-4.5 3.4 0 1.2.6 2.1 1.7 2.8M4 12h16M15.6 14c.6.6.9 1.3.9 2.1 0 2.2-2 3.9-4.8 3.9a5.4 5.4 0 0 1-4.7-2.3"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    unlink: '<path d="m18.8 12.7 1.7-1.7a5 5 0 0 0-7-7l-1.7 1.7M5.2 11.3 3.5 13a5 5 0 0 0 7 7l1.7-1.7M8 2v3M2 8h3M16 22v-3M22 16h-3"/>',
    bulletList: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
    orderedList: '<path d="M10 6h10M10 12h10M10 18h10M4 4.5h1.2V9M4 9h2.4M6.2 19H3.8c0-1.3 2.4-1.8 2.4-3.2 0-.7-.6-1.3-1.2-1.3-.6 0-1.1.3-1.2.9"/>',
    blockquote: '<path d="M17 6H3M21 12H8M21 18H8M3 12v6"/>',
    heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
    attach: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 0 1 5.6 5.7l-8.6 8.5a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    gif: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M9.5 8.5H7a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2.5V12H8M12 8.5v7M18.5 8.5h-4v7M14.5 12h3"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
    mention: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    reply: '<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    retry: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    pencil: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    page: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>',
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/>',
} as const;

export type IconName = keyof typeof PATHS;

// Icons that point along the line of text, which flip in a right-to-left layout. Numbered list stays,
// so its numbers don't read backwards.
const MIRRORED = new Set<IconName>(['reply', 'undo', 'redo', 'bulletList', 'blockquote']);

export function icon(name: IconName): SVGSVGElement {
    const template = document.createElement('template');
    const className = MIRRORED.has(name) ? 'verbb-editor__icon verbb-editor__icon--mirror' : 'verbb-editor__icon';

    template.innerHTML = `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;

    return template.content.firstElementChild as SVGSVGElement;
}
