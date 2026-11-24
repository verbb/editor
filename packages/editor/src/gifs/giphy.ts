/**
 * GIPHY's search, trending and pings. GIPHY's terms decide most of how this works: searches go from
 * the browser straight to GIPHY with the site's key, never through the site; results are used as
 * GIPHY sends them, in its order, with their addresses untouched; and each result's own pings report
 * it shown, chosen and sent, with an ID GIPHY makes up for this browser rather than anything about
 * the person.
 *
 * Nothing here imports the rest of Editor, so a host without the editor, such as a plain comment
 * form, loads it alone through `@verbb/editor/gifs`.
 */

const API = 'https://api.giphy.com/v1';
const CUSTOMER_KEY = 'verbb-editor-giphy-customer';

/** The longest search GIPHY takes. */
export const QUERY_MAX = 50;

/** GIPHY's content ratings, from most to least strict. */
export type GifRating = 'g' | 'pg' | 'pg-13' | 'r';

/**
 * What the browser needs to search GIPHY. The key is GIPHY's key for the web, which GIPHY treats as
 * public, so it goes to the page for anyone who can add a GIF.
 */
export interface GifConfig {
    apiKey: string;
    /** `g` by default. */
    rating?: GifRating;
    /** Results per search, 24 by default. */
    limit?: number;
    /** A two-letter language for searches, such as `fr`. English by default. */
    language?: string;
}

/** A GIF as it's saved: its address as GIPHY gave it, and its size when known. */
export interface EditorGif {
    url: string;
    width: number | null;
    height: number | null;
}

/** A chosen GIF, and the ping GIPHY wants once whatever it's in has been sent. */
export interface GifChoice {
    gif: EditorGif;
    sent: string | null;
}

type Rendition = { url?: string; webp?: string; width?: string | number; height?: string | number };

/** A result as GIPHY sends it. Only what Editor reads is typed; the rest is left alone. */
export type GiphyResult = {
    id?: string;
    title?: string;
    alt_text?: string;
    images?: Record<string, Rendition | undefined>;
    analytics?: { onload?: { url?: string }; onclick?: { url?: string }; onsent?: { url?: string } };
};

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

function readStored(): string | null {
    try {
        return sessionStorage.getItem(CUSTOMER_KEY);
    } catch {
        return null;
    }
}

function store(id: string): void {
    try {
        sessionStorage.setItem(CUSTOMER_KEY, id);
    } catch {
        // Private windows and blocked storage just ask GIPHY again next time.
    }
}

function size(value: string | number | undefined): number | null {
    const number = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);

    return Number.isFinite(number) && number > 0 ? number : null;
}

/** A rendition's address, WebP where GIPHY has one, as GIPHY's rendition guide asks. */
function address(rendition: Rendition | undefined): string | null {
    return rendition?.webp || rendition?.url || null;
}

/** A thumbnail for a grid: the fixed-width rendition GIPHY suggests for one. */
export function thumbnail(result: GiphyResult): { url: string | null; width: number | null; height: number | null } {
    const rendition = result.images?.fixed_width ?? result.images?.original;

    return { url: address(rendition), width: size(rendition?.width), height: size(rendition?.height) };
}

/** What's saved: the largest rendition, as GIPHY asks for a GIF that's sent. */
export function chosen(result: GiphyResult): EditorGif | null {
    const rendition = result.images?.original;
    const url = address(rendition);

    return url ? { url, width: size(rendition?.width), height: size(rendition?.height) } : null;
}

/** GIPHY's search, trending and pings, for one picker. */
export class Giphy {
    private customer: Promise<string | null> | null = null;
    private readonly seen = new Set<GiphyResult>();

    constructor(private readonly config: GifConfig, private readonly fetcher: Fetcher = (input, init) => fetch(input, init)) {}

    /**
     * The ID GIPHY uses for this browser in place of a user ID, made by GIPHY once and kept for the
     * session. Without one, searches and pings go without it.
     */
    customerId(): Promise<string | null> {
        this.customer ??= (async () => {
            const stored = readStored();

            if (stored) return stored;

            try {
                const response = await this.fetcher(`${API}/randomid?${new URLSearchParams({ api_key: this.config.apiKey })}`, { credentials: 'omit' });
                const body = await response.json() as { data?: { random_id?: unknown } };
                const id = body?.data?.random_id;

                if (typeof id === 'string' && id) {
                    store(id);

                    return id;
                }
            } catch {
                // Searching still works without it.
            }

            return null;
        })();

        return this.customer;
    }

    /** Trending GIFs for an empty query, otherwise a search. Results come back exactly as GIPHY sent them. */
    async search(query: string, signal?: AbortSignal): Promise<GiphyResult[]> {
        const q = query.trim().slice(0, QUERY_MAX);
        const params = new URLSearchParams({
            api_key: this.config.apiKey,
            limit: String(this.config.limit ?? 24),
            rating: this.config.rating ?? 'g',
            lang: this.config.language || 'en',
            bundle: 'messaging_non_clips',
        });

        if (q) params.set('q', q);

        const customer = await this.customerId();

        if (customer) params.set('customer_id', customer);

        const response = await this.fetcher(`${API}/gifs/${q ? 'search' : 'trending'}?${params}`, { signal, credentials: 'omit' });

        if (!response.ok) throw new Error(`GIPHY answered ${response.status}.`);

        const body = await response.json() as { data?: unknown };

        return Array.isArray(body?.data) ? body.data as GiphyResult[] : [];
    }

    /** Sends one of a result's pings, with the time and this browser's ID. Failures are ignored. */
    ping(url: string | null | undefined): void {
        if (!url) return;

        void this.customerId().then((customer) => {
            const target = new URL(url);

            target.searchParams.append('ts', String(Date.now()));

            if (customer) target.searchParams.append('customer_id', customer);

            return this.fetcher(target.toString(), { mode: 'no-cors', credentials: 'omit', keepalive: true });
        }).catch(() => undefined);
    }

    /** A result was shown, which GIPHY counts once. */
    shown(result: GiphyResult): void {
        if (this.seen.has(result)) return;

        this.seen.add(result);
        this.ping(result.analytics?.onload?.url);
    }
}
