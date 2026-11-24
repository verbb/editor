import type { ResolvedEditorOptions } from '../types';

/**
 * The parts of the editor that only some contexts use. These are type-only references, so nothing
 * here loads them. The npm entry (`index.ts`) provides them up front and the Composer bundle
 * (`bundle.ts`) provides them as separate chunks, loaded when an editor's features need them.
 */
export interface FeatureModules {
    link: typeof import('./link');
    linkTools: typeof import('./link-tools');
    mention: typeof import('./mention');
    uploads: typeof import('./uploads');
    /** GIF search, loaded the first time someone opens it rather than with the editor. */
    gifs: typeof import('../gifs/index');
}

export type FeatureName = keyof FeatureModules;

export type FeatureSources = { [Name in FeatureName]: FeatureModules[Name] | (() => Promise<FeatureModules[Name]>) };

let sources: Partial<FeatureSources> = {};
const loaded = new Map<FeatureName, FeatureModules[FeatureName]>();
const loading = new Map<FeatureName, Promise<void>>();

/** Sets where each feature comes from: the module itself, or a function that imports it. */
export function provideFeatures(provided: FeatureSources): void {
    sources = provided;
    loaded.clear();
    loading.clear();

    for (const name of Object.keys(provided) as FeatureName[]) {
        const source = provided[name];

        if (typeof source !== 'function') loaded.set(name, source);
    }
}

/** The features an editor with these options can't be built without. */
export function requiredFeatures({ features }: ResolvedEditorOptions): FeatureName[] {
    const names: FeatureName[] = [];

    if (features.link) names.push('link');
    if (features.link || features.craftLink) names.push('linkTools');
    if (features.mention) names.push('mention');
    if (features.image || features.attachment) names.push('uploads');

    return names;
}

export function missingFeatures(options: ResolvedEditorOptions): FeatureName[] {
    return requiredFeatures(options).filter((name) => !loaded.has(name));
}

export function loadRequiredFeatures(options: ResolvedEditorOptions): Promise<void> {
    return Promise.all(requiredFeatures(options).map(load)).then(() => undefined);
}

/** A loaded feature. Throws when it isn't loaded, because an editor built without it would drop content. */
export function feature<Name extends FeatureName>(name: Name): FeatureModules[Name] {
    const module = loaded.get(name);

    if (!module) {
        throw new Error(`Editor’s ${name} feature isn’t loaded. Create the editor with \`await Editor.create()\`, or call \`await loadFeatures(options)\` first.`);
    }

    return module as FeatureModules[Name];
}

/** Loads one feature, for those an editor loads when first used rather than up front. */
export function loadFeature<Name extends FeatureName>(name: Name): Promise<FeatureModules[Name]> {
    return load(name).then(() => loaded.get(name) as FeatureModules[Name]);
}

function load(name: FeatureName): Promise<void> {
    if (loaded.has(name)) return Promise.resolve();

    let pending = loading.get(name);

    if (!pending) {
        const source = sources[name];

        if (typeof source !== 'function') {
            return Promise.reject(new Error(`Editor’s ${name} feature isn’t available.`));
        }

        pending = source().then((module) => {
            loaded.set(name, module);
        }, (error: unknown) => {
            // A failed chunk can be tried again by the next editor that needs it.
            loading.delete(name);

            throw new Error(`Editor’s ${name} feature couldn’t be loaded.`, { cause: error });
        });

        loading.set(name, pending);
    }

    return pending;
}
