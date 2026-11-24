import { normalizeOptions } from '../config/normalizeOptions';
import { loadRequiredFeatures, missingFeatures } from './registry';

import type { EditorOptions } from '../types';

/**
 * Loads the features these options use, such as links, mentions and uploads. The Composer bundle
 * loads them on demand, so call this before `new Editor()`, or use `Editor.create()`. With the npm
 * package they're already there and this resolves at once.
 */
export function loadFeatures(options: EditorOptions = {}): Promise<void> {
    return loadRequiredFeatures(normalizeOptions(options));
}

/** Whether `new Editor()` can be built with these options now. */
export function featuresLoaded(options: EditorOptions = {}): boolean {
    return missingFeatures(normalizeOptions(options)).length === 0;
}
