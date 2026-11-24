/**
 * English defaults for every interface string. `EditorConfig::browserOptions()` emits the same keys
 * through Craft's translations, so consumers get translated strings without rebuilding the bundle.
 * `{name}`-style placeholders are filled in by `formatLabel()`, and a count that changes the wording
 * uses Craft's ICU plural form, such as `{count, plural, one{# photo} other{# photos}}`.
 */
export const DEFAULT_LABELS = {
    editor: 'Rich text editor',
    toolbar: 'Formatting',
    formatSelection: 'Format selection',
    more: 'More formatting',
    bold: 'Bold',
    italic: 'Italic',
    strike: 'Strikethrough',
    underline: 'Underline',
    code: 'Inline code',
    heading: 'Heading {level}',
    bulletList: 'Bulleted list',
    orderedList: 'Numbered list',
    blockquote: 'Quote',
    link: 'Link',
    mention: 'Mention someone',
    attach: 'Attach files',
    addPhotos: 'Add photos',
    gif: 'GIF',
    gifAdd: 'Add a GIF',
    gifSearch: 'Search GIPHY',
    gifResults: 'GIFs',
    gifEmpty: 'No GIFs found.',
    gifUnavailable: 'GIFs can’t be loaded right now.',
    gifPoweredBy: 'Powered by GIPHY',
    gifRemove: 'Remove GIF',
    undo: 'Undo',
    redo: 'Redo',
    formattingHelp: 'Formatting help',
    shortcuts: 'Shortcuts',
    markdown: 'Markdown works too',
    newLine: 'New line',
    either: '{first} or {second}',
    linkPrompt: 'Paste a link or search pages',
    linkPromptAddress: 'Paste or type a link',
    linkAddress: 'Link address or page',
    linkTo: 'Link to {address}',
    webAddress: 'Web address',
    suggestedPages: 'Suggested pages',
    pages: 'Pages on this site',
    noPages: 'No pages match “{query}”',
    noPagesHint: 'Paste a full address to link anywhere else.',
    pageLinksKeep: 'Page links keep working if the page moves.',
    pagesFailed: 'Couldn’t load pages. You can still paste an address.',
    enterToAdd: '↵ to add',
    invalidUrl: 'Enter a valid URL, email address or relative link.',
    openLink: 'Open link',
    editLink: 'Edit link',
    removeLink: 'Remove link',
    searching: 'Searching…',
    mentionSuggestions: 'Mention suggestions',
    mentionPeople: 'People',
    mentionIdle: 'Suggested people',
    mentionHint: 'Keep typing to search.',
    mentionNone: 'No one called “{query}”',
    mentionPlain: 'It’ll post as plain text.',
    mentionFailed: 'Couldn’t load people',
    mentionFailedHint: 'Keep typing and it’ll post as plain text.',
    mentionKeys: '↑↓ to choose · ↵ to mention',
    tryAgain: 'Try again',
    uploads: 'Uploads',
    uploadingFile: 'Uploading {name}, {percent}%',
    uploadingStatus: 'Uploading…',
    uploaded: '{name} uploaded.',
    uploadFailedShort: 'Didn’t upload',
    uploadFailed: '{name} didn’t upload. {reason}',
    retry: 'Retry',
    retryUpload: 'Retry upload of {name}',
    remove: 'Remove {name}',
    uploadPending: 'Please wait for your uploads to finish.',
    uploadsFailed: 'Retry or remove the upload that didn’t finish.',
    unsupportedFile: '{name} can’t be added here.',
    fileTooLarge: '{name} is larger than the upload limit.',
    tooManyImages: '{count, plural, one{You can add up to # photo.} other{You can add up to # photos.}}',
    tooManyFiles: '{count, plural, one{You can add up to # file.} other{You can add up to # files.}}',
    dropToAttach: 'Drop to attach',
    altText: 'Alt text',
    addAlt: 'Add alt text for {name}',
    editAlt: 'Edit alt text for {name}',
    altPrompt: 'What’s in the photo?',
    altHint: 'Describes the photo for people using screen readers. One sentence is plenty.',
    save: 'Save',
    cancel: 'Cancel',
    dismiss: 'Dismiss',
    uploadedImage: 'Uploaded image',
    attachment: 'Attachment',
    required: 'Please enter some text.',
    replyingTo: 'Replying to {name}',
    cancelReply: 'Cancel reply',
    submit: 'Post',
    posting: 'Posting…',
    writeFirst: 'Write something first.',
    draftSaved: 'Draft saved',
    draftRestored: 'Restored your draft from {time}.',
    draftFilesDropped: 'Files older than a day were removed.',
    discard: 'Discard',
    tooLong: '{count, plural, one{Too long by # character} other{Too long by # characters}}',
    charactersLeft: '{count, plural, one{# character left} other{# characters left}}',
    charactersOf: '{count} of {limit} characters',
    postFailed: 'Couldn’t post. Check your connection and try again. Your text is still here.',
    connectionFailed: 'Unable to connect. Please try again.',
    accessDenied: 'Sign in again or check your access to this resource.',
    tooManyRequests: 'Too many requests. Please wait and try again.',
    somethingWrong: 'Something went wrong. Please try again.',
} as const;

export type EditorLabels = Record<keyof typeof DEFAULT_LABELS, string>;

type LabelValues = Record<string, string | number>;

let pluralRules: Intl.PluralRules | undefined;

/** The page's plural rules, so `one`, `few` and `many` follow its language. */
function pluralCategory(value: number): string {
    if (!pluralRules) {
        const lang = typeof document === 'undefined' ? undefined : document.documentElement.lang || undefined;

        // Some sites set a `lang` that isn't a valid language tag, such as `en_US`.
        try {
            pluralRules = new Intl.PluralRules(lang);
        } catch {
            pluralRules = new Intl.PluralRules();
        }
    }

    return pluralRules.select(value);
}

/** The index of the `}` that closes the `{` at `start`, or -1. */
function closingBrace(text: string, start: number): number {
    let depth = 0;

    for (let index = start; index < text.length; index++) {
        if (text[index] === '{') depth++;
        if (text[index] === '}' && --depth === 0) return index;
    }

    return -1;
}

/** Picks the branch of `{name, plural, =1{…} one{…} other{…}}` that suits the value. */
function formatPlural(value: number, branches: string, values: LabelValues): string | null {
    const options = new Map<string, string>();
    let index = 0;

    while (index < branches.length) {
        const selector = /^\s*(=\d+|\w+)\s*\{/.exec(branches.slice(index));

        if (!selector) break;

        const open = index + selector[0].length - 1;
        const close = closingBrace(branches, open);

        if (close < 0) return null;

        options.set(selector[1], branches.slice(open + 1, close));
        index = close + 1;
    }

    const branch = options.get(`=${value}`) ?? options.get(pluralCategory(value)) ?? options.get('other');

    return branch === undefined ? null : formatLabel(branch.replace(/#/g, String(value)), values);
}

/**
 * Fills `{name}` placeholders, and picks the right branch of an ICU plural, the message syntax
 * Craft's translations use, so a translator writes one label for every plural form of their
 * language. `#` in a branch is the value. A placeholder without a value is left as it is.
 */
export function formatLabel(label: string, values: LabelValues): string {
    let result = '';
    let index = 0;

    while (index < label.length) {
        const close = label[index] === '{' ? closingBrace(label, index) : -1;

        if (close < 0) {
            result += label[index];
            index++;
            continue;
        }

        const placeholder = label.slice(index, close + 1);
        const argument = /^\{\s*(\w+)\s*(?:,\s*plural\s*,([\s\S]*))?\}$/.exec(placeholder);
        const name = argument?.[1];
        let replacement: string | null = null;

        if (argument && name !== undefined && name in values) {
            replacement = argument[2] === undefined
                ? String(values[name])
                : formatPlural(Number(values[name]), argument[2], values);
        }

        result += replacement ?? placeholder;
        index = close + 1;
    }

    return result.trim();
}
