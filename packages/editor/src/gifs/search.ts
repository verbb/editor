import { chosen, Giphy, type Fetcher, type GifChoice, type GifConfig, type GiphyResult } from './giphy';

const SEARCH_DELAY = 300;

export type GifSearchStatus = 'loading' | 'ready' | 'error';

/** One picker's search: what was asked, what GIPHY found, and whether it's still looking. */
export class GifSearch {
    readonly giphy: Giphy;
    query = '';
    status: GifSearchStatus = 'loading';
    results: GiphyResult[] = [];
    private timer: ReturnType<typeof setTimeout> | undefined;
    private request: AbortController | null = null;

    constructor(config: GifConfig, private readonly changed: () => void, fetcher?: Fetcher) {
        this.giphy = new Giphy(config, fetcher);
    }

    /** Opening shows what's trending, as GIPHY's own pickers do. */
    start(): Promise<void> {
        return this.load(this.query);
    }

    /** Searches once typing pauses. */
    type(query: string): void {
        this.query = query;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.load(query), SEARCH_DELAY);
    }

    /** Searches straight away, as when Enter is pressed. */
    now(query: string): Promise<void> {
        this.query = query;
        clearTimeout(this.timer);

        return this.load(query);
    }

    /** The GIF at a place in the results, which GIPHY is told was chosen. */
    choose(index: number): GifChoice | null {
        const result = this.results[index];
        const gif = result ? chosen(result) : null;

        if (!result || !gif) return null;

        this.giphy.ping(result.analytics?.onclick?.url);

        return { gif, sent: result.analytics?.onsent?.url ?? null };
    }

    /** Counts the results now on screen as shown. */
    shown(): void {
        this.results.forEach((result) => this.giphy.shown(result));
    }

    stop(): void {
        clearTimeout(this.timer);
        this.request?.abort();
        this.request = null;
    }

    private async load(query: string): Promise<void> {
        this.request?.abort();

        const request = new AbortController();

        this.request = request;
        this.status = 'loading';
        this.changed();

        try {
            const results = await this.giphy.search(query, request.signal);

            if (request.signal.aborted) return;

            this.results = results;
            this.status = 'ready';
        } catch {
            if (request.signal.aborted) return;

            this.results = [];
            this.status = 'error';
        }

        this.changed();
    }
}
