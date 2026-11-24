/**
 * The same rules as `Sanitizer::isSafeLink()` on the server, checked against one shared fixture
 * table: otherwise a link the browser accepts is silently removed on save.
 */
const SAFE_SCHEMES = ['http', 'https', 'mailto'];

function decodeEntities(value: string): string {
    if (!value.includes('&')) return value;

    // A textarea decodes entities without ever parsing markup or loading anything.
    const decoder = document.createElement('textarea');
    decoder.innerHTML = value;

    return decoder.value;
}

function decodeUrl(url: string): string {
    let decoded = url;

    for (let i = 0; i < 3; i++) {
        let next = decodeEntities(decoded);

        // Decode runs one escape at a time, so stray `%` signs leave the rest intact.
        next = next.replace(/%[0-9a-f]{2}/gi, (escape) => String.fromCharCode(parseInt(escape.slice(1), 16)));

        if (next === decoded) break;
        decoded = next;
    }

    return decoded.trim();
}

function schemeOf(url: string): string | null {
    const candidate = (decodeUrl(url).split(/[/?#]/, 1)[0] ?? '').replace(/[\u0000- \u007f]+/g, '');
    const colon = candidate.indexOf(':');

    return colon === -1 ? null : candidate.slice(0, colon).toLowerCase();
}

function isSafeLink(value: unknown): value is string {
    if (typeof value !== 'string') return false;

    const url = value.trim();

    // Whitespace and control characters split schemes, and a leading backslash is treated as a slash.
    if (!url || url.startsWith('\\') || /[\u0000- \u007f]/.test(url)) return false;

    const scheme = schemeOf(url);

    return scheme === null || SAFE_SCHEMES.includes(scheme);
}

/** Keep browser previews/navigation within the same protocols as server-rendered content. */
export function safeUrl(value: unknown, image = false): string {
    if (!isSafeLink(value)) return '';

    const url = value.trim();

    return image && schemeOf(url) === 'mailto' ? '' : url;
}

/**
 * Authors type `example.com` and `me@example.com`. Left alone those become relative links, so the
 * link panel adds the scheme. Explicitly relative input and anything with a scheme stay as typed.
 */
export function normalizeLinkInput(value: string): string {
    const url = value.trim();

    if (!url || /^(\/|\.\/|\.\.\/|#|\?)/.test(url) || /^[a-z][a-z\d+.-]*:/i.test(url)) return url;
    if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(url)) return `mailto:${url}`;
    if (/^[^\s/?#]+\.[a-z]{2,}([/?#:].*)?$/i.test(url)) return `https://${url}`;

    return url;
}
