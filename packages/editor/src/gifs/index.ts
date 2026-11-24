/**
 * GIF search through GIPHY, for the editor's GIF control and for hosts that offer GIFs without the
 * editor. It imports nothing from the rest of Editor, so `@verbb/editor/gifs` loads it alone.
 */
export { chosen, Giphy, QUERY_MAX, thumbnail } from './giphy';
export type { EditorGif, Fetcher, GifChoice, GifConfig, GifRating, GiphyResult } from './giphy';
export { GIF_PICKER_LABELS, GifPicker } from './picker';
export type { GifPickerClasses, GifPickerLabels, GifPickerOptions } from './picker';
export { GifSearch } from './search';
export type { GifSearchStatus } from './search';
