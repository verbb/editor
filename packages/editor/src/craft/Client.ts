import { DEFAULT_LABELS, type EditorLabels } from '../config/labels';
import { safeUrl } from '../core/urls';
import { EditorSetupError, resolveCsrfToken } from './csrf';

import type { CraftEndpoints, CraftOptions, EditorRequestOptions } from '../types';
import type { AssetUploadResult, ElementSearchResult, MentionSearchResult } from './types';

export interface CraftRequestOptions {
    signal?: AbortSignal;
}

export interface CraftUploadOptions extends CraftRequestOptions {
    /** Called with a fraction from 0 to 1 as the file is sent. */
    onProgress?: (fraction: number) => void;
}

const CREDENTIALS: RequestCredentials[] = ['omit', 'same-origin', 'include'];

// Editor sets these itself, and a multipart upload needs the browser to choose its own boundary.
const RESERVED_HEADERS = ['accept', 'content-type'];

// What fetch and XHR accept, checked here so a mistake reads as a setup error rather than a failed request.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HEADER_VALUE = /^[^\0\r\n]*$/;

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function reference(value: unknown): value is MentionSearchResult {
    return record(value) && Number.isSafeInteger(value.id) && Number(value.id) > 0
        && typeof value.type === 'string' && typeof value.label === 'string';
}

/** Keeps the optional display fields only when they're the right shape and the image is safe. */
function withExtras<T extends MentionSearchResult>(item: T): T {
    const result = { ...item };

    if (typeof item.description !== 'string' || !item.description.trim()) delete result.description;
    if (typeof item.imageUrl !== 'string' || !safeUrl(item.imageUrl, true)) delete result.imageUrl;

    return result;
}

export class CraftClient {
    constructor(
        private readonly _options: CraftOptions,
        private readonly _labels: EditorLabels = DEFAULT_LABELS,
        private readonly _transport: EditorRequestOptions = {},
    ) {}

    get context(): string | undefined {
        return this._options.context;
    }

    async searchElements(query: string, options: CraftRequestOptions = {}): Promise<ElementSearchResult[]> {
        const data = await this._post('elements', { query }, options);

        if (!record(data) || !Array.isArray(data.results)) throw new Error(this._labels.somethingWrong);

        return data.results
            .filter((item): item is ElementSearchResult => reference(item) && 'url' in item && !!safeUrl(item.url))
            .map(withExtras);
    }

    async searchMentions(query: string, options: CraftRequestOptions = {}): Promise<MentionSearchResult[]> {
        const data = await this._post('mentions', { query }, options);

        if (!record(data) || !Array.isArray(data.results)) throw new Error(this._labels.somethingWrong);

        return data.results.filter(reference).map(withExtras);
    }

    async uploadAsset(file: File, kind: 'inlineImage' | 'attachment' = 'inlineImage', options: CraftUploadOptions = {}): Promise<AssetUploadResult> {
        const body = new FormData();

        body.append('file', file);
        body.append('kind', kind);

        if (this._options.context) body.append('context', this._options.context);
        // Multipart bodies have no JSON parser, so scope travels as a JSON field.
        if (this._options.scope) body.append('scope', JSON.stringify(this._options.scope));

        const csrf = resolveCsrfToken(this._options);

        if (csrf) body.append(csrf.name, csrf.value);

        // Static headers start the upload in this same turn, as it always has; only a function waits.
        const pending = this._headers(csrf ? { 'X-CSRF-Token': csrf.value } : {});
        const headers = pending instanceof Promise ? await pending : pending;
        const data = await this._send('upload', body, headers, options);
        const asset = record(data) ? data.asset : null;

        if (!record(asset) || !Number.isSafeInteger(asset.id) || Number(asset.id) <= 0
            || typeof asset.filename !== 'string'
            || (asset.url !== null && (typeof asset.url !== 'string' || !safeUrl(asset.url, kind === 'inlineImage')))
            || asset.kind !== kind) {
            throw new Error(this._labels.somethingWrong);
        }

        return {
            id: Number(asset.id),
            filename: asset.filename,
            url: asset.url as string | null,
            kind,
            temporary: typeof asset.temporary === 'boolean' ? asset.temporary : undefined,
            mimeType: typeof asset.mimeType === 'string' ? asset.mimeType : undefined,
            size: typeof asset.size === 'number' && Number.isFinite(asset.size) && asset.size >= 0 ? asset.size : undefined,
        };
    }

    private async _post(endpoint: keyof CraftEndpoints, body: Record<string, unknown>, options: CraftRequestOptions): Promise<unknown> {
        const payload: Record<string, unknown> = {
            ...body,
            ...(this._options.context ? { context: this._options.context } : {}),
            ...(this._options.scope ? { scope: this._options.scope } : {}),
        };
        const csrf = resolveCsrfToken(this._options);
        const own: Record<string, string> = { 'Content-Type': 'application/json' };

        if (csrf) {
            own['X-CSRF-Token'] = csrf.value;
            payload[csrf.name] = csrf.value;
        }

        const headers = await this._headers(own);

        return this._request(endpoint, { headers, body: JSON.stringify(payload), signal: options.signal });
    }

    /** The `credentials` mode, `same-origin` unless the host chose another. Any other value is a setup mistake. */
    private _credentials(): RequestCredentials {
        const credentials = this._transport.credentials;

        if (credentials === undefined) return 'same-origin';
        if (CREDENTIALS.includes(credentials)) return credentials;

        throw new EditorSetupError(`Editor's \`request.credentials\` must be \`omit\`, \`same-origin\` or \`include\`.`);
    }

    /**
     * The host's headers under Editor's own, so a stale or mistaken `Content-Type` or CSRF header
     * can't break a request. Headers from a function are read fresh for every request.
     */
    private _headers(own: Record<string, string>): Record<string, string> | Promise<Record<string, string>> {
        const option = this._transport.headers;

        if (typeof option !== 'function') return this._mergeHeaders(option, own);

        const failed = (error: unknown): Error => {
            // A token that can't be fetched looks like a failed connection to the author.
            console.error('Editor couldn’t read its request headers.', error);

            return new Error(this._labels.connectionFailed);
        };

        try {
            return Promise.resolve(option()).then((extra) => this._mergeHeaders(extra, own), (error) => {
                throw failed(error);
            });
        } catch (error) {
            return Promise.reject(failed(error));
        }
    }

    private _mergeHeaders(extra: unknown, own: Record<string, string>): Record<string, string> {
        if (extra != null && !record(extra)) {
            throw new EditorSetupError('Editor\'s `request.headers` must be an object of header names and values, or a function returning one.');
        }

        const headers: Record<string, string> = { Accept: 'application/json' };
        const ownNames = Object.keys(own).map((name) => name.toLowerCase());

        for (const [name, value] of Object.entries(extra ?? {})) {
            const lower = name.toLowerCase();

            if (value == null || RESERVED_HEADERS.includes(lower) || ownNames.includes(lower)) continue;

            if (!HEADER_NAME.test(name) || !HEADER_VALUE.test(String(value))) {
                throw new EditorSetupError(`Editor's \`request.headers\` has an invalid header: ${name}.`);
            }

            headers[name] = String(value);
        }

        return { ...headers, ...own };
    }

    private _url(endpoint: keyof CraftEndpoints): string {
        const url = this._options.endpoints?.[endpoint];

        if (!url) {
            throw new EditorSetupError(`Editor has no \`${endpoint}\` endpoint. Pass the options from \`EditorConfig::browserOptions()\`.`);
        }

        return url;
    }

    private async _request(endpoint: keyof CraftEndpoints, options: RequestInit): Promise<unknown> {
        const url = this._url(endpoint);
        const credentials = this._credentials();
        let response: Response;

        try {
            response = await fetch(url, { ...options, method: 'POST', credentials });
        } catch (error) {
            if (options.signal?.aborted || (record(error) && error.name === 'AbortError')) throw error;
            throw new Error(this._labels.connectionFailed);
        }

        let payload: unknown;

        try {
            payload = await response.json();
        } catch {
            payload = null;
        }

        return this._payload(response.status, payload);
    }

    /** Uploads go through XHR, because fetch can't report how much of a file has been sent. */
    private _send(endpoint: keyof CraftEndpoints, body: FormData, headers: Record<string, string>, options: CraftUploadOptions): Promise<unknown> {
        const url = this._url(endpoint);
        // Cookies cross origins only when asked, as with fetch. XHR has no way to leave them off its own origin.
        const withCredentials = this._credentials() === 'include';

        return new Promise((resolve, reject) => {
            const request = new XMLHttpRequest();
            const abort = () => request.abort();

            if (options.signal?.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));

                return;
            }

            options.signal?.addEventListener('abort', abort, { once: true });
            request.open('POST', url);
            request.withCredentials = withCredentials;
            Object.entries(headers).forEach(([name, value]) => request.setRequestHeader(name, value));
            request.responseType = 'text';
            request.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable && event.total > 0) options.onProgress?.(event.loaded / event.total);
            });
            request.addEventListener('load', () => {
                options.signal?.removeEventListener('abort', abort);

                let payload: unknown = null;

                try {
                    payload = JSON.parse(request.responseText);
                } catch {
                    payload = null;
                }

                try {
                    resolve(this._payload(request.status, payload));
                } catch (error) {
                    reject(error);
                }
            });
            request.addEventListener('error', () => {
                options.signal?.removeEventListener('abort', abort);
                reject(new Error(this._labels.connectionFailed));
            });
            request.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            request.send(body);
        });
    }

    private _payload(status: number, payload: unknown): unknown {
        if ([401, 403].includes(status)) throw new Error(this._labels.accessDenied);
        if (status === 429) throw new Error(this._labels.tooManyRequests);

        if (status < 200 || status >= 300) {
            // Controllers already provide safe messages; never surface an HTML error page or exception body.
            throw new Error(record(payload) && typeof payload.message === 'string' ? payload.message : this._labels.somethingWrong);
        }

        if (!record(payload)) throw new Error(this._labels.somethingWrong);

        return payload;
    }
}
