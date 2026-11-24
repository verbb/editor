import type { CraftOptions } from '../types';

/** A mistake in how the page set Editor up, which an author can't fix. Logged rather than shown. */
export class EditorSetupError extends Error {}

export interface CsrfToken {
    name: string;
    value: string;
}

/**
 * `null` means the site has CSRF protection off. A site with protection on and no token anywhere is
 * a developer mistake that would otherwise look like a failed request to the author, so it throws.
 */
export function resolveCsrfToken(options: CraftOptions): CsrfToken | null {
    if (options.csrfToken === false) {
        return null;
    }

    if (options.csrfToken && options.csrfTokenName) {
        return {
            name: options.csrfTokenName,
            value: options.csrfToken,
        };
    }

    const token = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content;
    const name = document.querySelector<HTMLMetaElement>('meta[name="csrf-token-name"]')?.content ?? 'CRAFT_CSRF_TOKEN';

    if (!token) {
        throw new EditorSetupError('Editor needs a CSRF token for Craft requests. Pass the options from `EditorConfig::browserOptions()`.');
    }

    return { name, value: token };
}
