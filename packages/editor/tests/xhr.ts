import { vi } from 'vitest';

type Reply = { status: number; body: unknown } | 'error';

/**
 * Uploads go through XMLHttpRequest for progress, which jsdom can't send anywhere. This stands in for
 * it: each request is recorded and answered by `respond`, which may return a promise to hold it open.
 */
export function stubUploads(respond: (body: FormData, request: FakeUpload) => Reply | Promise<Reply>) {
    const requests: FakeUpload[] = [];

    class Stub extends FakeUpload {
        constructor() {
            super(respond);
            requests.push(this);
        }
    }

    vi.stubGlobal('XMLHttpRequest', Stub);

    return requests;
}

export class FakeUpload {
    readonly upload = new EventTarget();
    status = 0;
    responseText = '';
    responseType = '';
    withCredentials = false;
    url = '';
    headers: Record<string, string> = {};
    body: FormData | null = null;
    aborted = false;

    private readonly listeners: Record<string, (() => void)[]> = {};

    constructor(private readonly respond: (body: FormData, request: FakeUpload) => Reply | Promise<Reply>) {}

    open(_method: string, url: string): void {
        this.url = url;
    }

    setRequestHeader(name: string, value: string): void {
        this.headers[name] = value;
    }

    addEventListener(type: string, listener: () => void): void {
        (this.listeners[type] ??= []).push(listener);
    }

    abort(): void {
        this.aborted = true;
        this.emit('abort');
    }

    progress(loaded: number, total: number): void {
        const event = Object.assign(new Event('progress'), { lengthComputable: true, loaded, total });

        this.upload.dispatchEvent(event);
    }

    send(body: FormData): void {
        this.body = body;

        void Promise.resolve(this.respond(body, this)).then((reply) => {
            if (this.aborted) return;

            if (reply === 'error') {
                this.emit('error');

                return;
            }

            this.status = reply.status;
            this.responseText = JSON.stringify(reply.body);
            this.emit('load');
        });
    }

    private emit(type: string): void {
        (this.listeners[type] ?? []).forEach((listener) => listener());
    }
}
