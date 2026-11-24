import { QUERY_MAX, thumbnail, type Fetcher, type GifChoice, type GifConfig } from './giphy';
import { GifSearch } from './search';

/** The picker's strings. Editor passes its own labels; another host passes its translations. */
export interface GifPickerLabels {
    gif: string;
    gifSearch: string;
    gifResults: string;
    gifEmpty: string;
    gifUnavailable: string;
    gifPoweredBy: string;
}

/**
 * The class on each part. A host that styles its own picker, such as Comments' plain form, passes
 * its own names; several classes go in one string, separated by spaces.
 */
export interface GifPickerClasses {
    picker: string;
    search: string;
    results: string;
    cell: string;
    result: string;
    image: string;
    status: string;
    attribution: string;
    /** Visually hidden but read by screen readers, for the search's label. */
    hidden: string;
}

export interface GifPickerOptions {
    config: GifConfig;
    /** Called with the GIF someone chose. The picker stays as it is; the host closes it. */
    onChoose: (choice: GifChoice) => void;
    /** Called when Escape is pressed in the picker. */
    onClose?: () => void;
    labels?: Partial<GifPickerLabels>;
    classes?: Partial<GifPickerClasses>;
    /** The start of the ids for its search and results, unique on the page. */
    id?: string;
    /** In place of the browser's `fetch`, for tests. */
    fetcher?: Fetcher;
}

export const GIF_PICKER_LABELS: GifPickerLabels = {
    gif: 'GIF',
    gifSearch: 'Search GIPHY',
    gifResults: 'GIFs',
    gifEmpty: 'No GIFs found.',
    gifUnavailable: 'GIFs can’t be loaded right now.',
    gifPoweredBy: 'Powered by GIPHY',
};

const CLASSES: GifPickerClasses = {
    picker: 'verbb-editor__gifs',
    search: 'verbb-editor__gifs-search',
    results: 'verbb-editor__gifs-results',
    cell: 'verbb-editor__gifs-cell',
    result: 'verbb-editor__gifs-result',
    image: 'verbb-editor__gifs-image',
    status: 'verbb-editor__gifs-status',
    attribution: 'verbb-editor__gifs-attribution',
    hidden: 'verbb-editor__sr',
};

let pickerCounter = 0;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);

    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;

    return node;
}

/**
 * GIF search: a search box, GIPHY's results as buttons, what's happening, and the "Powered by GIPHY"
 * mark GIPHY's terms ask for wherever its search is used. It draws plain DOM and imports nothing from
 * the rest of Editor, so any host can place `element` where it likes.
 */
export class GifPicker {
    readonly element: HTMLElement;
    readonly search: GifSearch;

    private readonly labels: GifPickerLabels;
    private readonly classes: GifPickerClasses;
    private readonly input: HTMLInputElement;
    private readonly list: HTMLElement;
    private readonly status: HTMLElement;
    private drawn: unknown = null;

    constructor(private readonly options: GifPickerOptions) {
        const id = options.id ?? `verbb-editor-gifs-${++pickerCounter}`;
        const classes = this.classes = { ...CLASSES, ...options.classes };
        const labels = this.labels = { ...GIF_PICKER_LABELS, ...options.labels };
        const label = make('label', classes.hidden, labels.gifSearch);

        this.search = new GifSearch(options.config, () => this.draw(), options.fetcher);
        this.element = make('div', classes.picker);
        this.element.setAttribute('role', 'group');
        this.element.setAttribute('aria-label', labels.gifSearch);

        this.input = make('input', classes.search);
        this.input.id = `${id}-search`;
        this.input.type = 'search';
        this.input.placeholder = labels.gifSearch;
        this.input.maxLength = QUERY_MAX;
        this.input.autocomplete = 'off';
        this.input.setAttribute('aria-controls', `${id}-results`);
        label.htmlFor = this.input.id;

        this.list = make('div', classes.results);
        this.list.id = `${id}-results`;
        this.list.setAttribute('role', 'list');
        this.list.setAttribute('aria-label', labels.gifResults);

        this.status = make('p', classes.status);
        this.status.setAttribute('role', 'status');

        this.element.append(label, this.input, this.list, this.status, make('p', classes.attribution, labels.gifPoweredBy));

        this.input.addEventListener('input', () => this.search.type(this.input.value));
        // Enter searches rather than submitting a form around the picker, and Escape closes only the
        // picker. Neither reaches an editor or dialog the picker sits in.
        this.element.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && options.onClose) {
                event.preventDefault();
                event.stopPropagation();
                options.onClose();
            } else if (event.key === 'Enter' && event.target === this.input) {
                event.preventDefault();
                event.stopPropagation();
                void this.search.now(this.input.value);
            }
        });
        this.list.addEventListener('click', (event) => {
            const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-index]') : null;
            const choice = button && this.list.contains(button) ? this.search.choose(Number(button.dataset.index)) : null;

            if (choice) options.onChoose(choice);
        });

        this.draw();
    }

    /** Shows what's trending, or the last search, and moves to the search box. */
    open(): void {
        if (this.search.status !== 'ready') void this.search.start();
        else this.search.shown();

        this.focus();
    }

    focus(): void {
        this.input.focus();
    }

    /** Stops any search under way. The host removes `element`. */
    stop(): void {
        this.search.stop();
    }

    private draw(): void {
        const { status, results } = this.search;
        const loading = status === 'loading';

        this.list.setAttribute('aria-busy', String(loading));
        this.status.textContent = status === 'error' ? this.labels.gifUnavailable : status === 'ready' && !results.length ? this.labels.gifEmpty : '';

        if (this.drawn !== results) {
            this.drawn = results;
            this.list.replaceChildren(...results.map((result, index) => {
                const cell = make('div', this.classes.cell);
                const button = make('button', this.classes.result);
                const image = thumbnail(result);
                const name = result.alt_text || result.title || this.labels.gif;

                cell.setAttribute('role', 'listitem');
                button.type = 'button';
                button.dataset.index = String(index);

                if (image.url) {
                    const img = make('img', this.classes.image);

                    img.src = image.url;
                    img.alt = name;
                    img.loading = 'lazy';

                    if (image.width) img.width = image.width;
                    if (image.height) img.height = image.height;

                    button.append(img);
                } else {
                    button.append(make('span', this.classes.hidden, name));
                }

                cell.append(button);

                return cell;
            }));
        }

        // GIPHY counts each result once it's on screen.
        if (status === 'ready' && this.element.isConnected) this.search.shown();
    }
}
