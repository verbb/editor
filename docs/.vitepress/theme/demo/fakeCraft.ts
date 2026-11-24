/**
 * A stand-in for Editor's Craft endpoints, so the docs demos run without a Craft site.
 *
 * Requests to `/__editor-demo/*` are answered in the browser with the same response shapes the
 * real controllers send. Every other request goes through untouched. Each demo gets its own
 * `?demo=` id, so one demo can fail its uploads while the next carries on normally.
 */
import { PAGES, PEOPLE } from './data';

export interface DemoSimulation {
    uploadFail?: boolean;
    mentionFail?: boolean;
    postFail?: boolean;
}

const PREFIX = '/__editor-demo/';
const simulations = new Map<string, DemoSimulation>();
let installed = false;
let nextId = 1;
let nextAssetId = 100;

export function registerDemo(simulation: DemoSimulation): { id: string; endpoints: Record<string, string>; release: () => void } {
    install();

    const id = String(nextId++);

    simulations.set(id, simulation);

    return {
        id,
        endpoints: {
            mentions: `${PREFIX}mentions?demo=${id}`,
            elements: `${PREFIX}elements?demo=${id}`,
            upload: `${PREFIX}upload?demo=${id}`,
        },
        release: () => simulations.delete(id),
    };
}

function simulationFor(url: string): DemoSimulation {
    const id = new URL(url, window.location.href).searchParams.get('demo') ?? '';

    return simulations.get(id) ?? {};
}

function endpointOf(url: string): string | null {
    if (!url.startsWith(PREFIX)) return null;

    return url.slice(PREFIX.length).split('?')[0] ?? null;
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);

        signal?.addEventListener('abort', () => {
            window.clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

function search(endpoint: string, query: string): Record<string, unknown>[] {
    const needle = query.trim().toLowerCase();

    if (endpoint === 'mentions') {
        // Like the default provider with `eligibleIds` set: an empty query suggests people.
        return PEOPLE
            .filter((person) => !needle || person.label.toLowerCase().includes(needle))
            .slice(0, 6)
            .map(({ id, label, description }) => ({ id, type: 'craft\\elements\\User', label, description }));
    }

    // One-character page queries return nothing, as they do on the server.
    if (needle.length === 1) return [];

    return PAGES
        .filter((page) => !needle || page.label.toLowerCase().includes(needle))
        .slice(0, 6)
        .map(({ id, label, description, url }) => ({ id, type: 'craft\\elements\\Entry', label, description, url }));
}

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function install(): void {
    if (installed || typeof window === 'undefined') return;

    installed = true;

    const realFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const endpoint = endpointOf(url);

        if (!endpoint) return realFetch(input, init);

        const simulation = simulationFor(url);
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { query?: string } : {};

        await wait(250 + Math.random() * 250, init?.signal);

        if (endpoint === 'mentions' && simulation.mentionFail) {
            return json(500, { message: 'The people search is unavailable.' });
        }

        return json(200, { results: search(endpoint, String(body.query ?? '')) });
    };

    window.XMLHttpRequest = FakeableXHR as unknown as typeof XMLHttpRequest;
}

const RealXHR = typeof window === 'undefined' ? (class {} as typeof XMLHttpRequest) : window.XMLHttpRequest;

/** Uploads use XHR for progress, so the stand-in has to answer those too. */
class FakeableXHR extends RealXHR {
    private _demoUrl: string | null = null;
    private _demoStatus = 0;
    private _demoResponse = '';
    private _demoTimers: number[] = [];

    open(method: string, url: string | URL, ...rest: unknown[]): void {
        const href = String(url);

        if (endpointOf(href)) {
            this._demoUrl = href;

            return;
        }

        // @ts-expect-error forwarding the optional async/user/password arguments
        super.open(method, url, ...rest);
    }

    setRequestHeader(name: string, value: string): void {
        if (!this._demoUrl) super.setRequestHeader(name, value);
    }

    get status(): number {
        return this._demoUrl ? this._demoStatus : super.status;
    }

    get responseText(): string {
        return this._demoUrl ? this._demoResponse : super.responseText;
    }

    send(body?: Document | XMLHttpRequestBodyInit | null): void {
        if (!this._demoUrl) {
            super.send(body);

            return;
        }

        const simulation = simulationFor(this._demoUrl);
        const form = body instanceof FormData ? body : new FormData();
        const file = form.get('file');
        const kind = String(form.get('kind') ?? 'inlineImage');
        const size = file instanceof File ? file.size : 0;
        const steps = 12;
        const total = Math.max(size, 1);
        // Long enough to watch the progress ring, short enough not to drag.
        const step = 1600 / steps;

        for (let i = 1; i <= steps; i++) {
            this._demoTimers.push(window.setTimeout(() => {
                const loaded = Math.round((total * i) / steps);

                this.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded, total }));

                if (i !== steps) return;

                if (simulation.uploadFail) {
                    this._finish(500, { message: 'The file couldn’t be saved. Try again in a moment.' });

                    return;
                }

                this._finish(200, {
                    asset: {
                        id: nextAssetId++,
                        filename: file instanceof File ? file.name : 'upload',
                        // Native temporary Assets have no public URL yet; Editor previews them locally.
                        url: null,
                        kind,
                        temporary: true,
                        mimeType: file instanceof File ? file.type : undefined,
                        size,
                    },
                });
            }, step * i));
        }
    }

    abort(): void {
        if (!this._demoUrl) {
            super.abort();

            return;
        }

        this._demoTimers.forEach((timer) => window.clearTimeout(timer));
        this._demoTimers = [];
        this.dispatchEvent(new ProgressEvent('abort'));
    }

    private _finish(status: number, payload: unknown): void {
        this._demoStatus = status;
        this._demoResponse = JSON.stringify(payload);
        this.dispatchEvent(new ProgressEvent('load'));
    }
}
