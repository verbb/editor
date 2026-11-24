import * as link from './features/link';
import * as gifs from './gifs/index';
import * as linkTools from './features/link-tools';
import * as mention from './features/mention';
import { provideFeatures } from './features/registry';
import * as uploads from './features/uploads';

export * from './public';

// The npm entry includes every feature, so `new Editor()` works straight away and a site's own
// bundler decides how to split it. This lives in the entry, never a side-effect-only import, which
// `sideEffects` would let a bundler drop.
provideFeatures({ link, linkTools, mention, uploads, gifs });
