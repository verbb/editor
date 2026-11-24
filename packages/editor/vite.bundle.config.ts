import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { defineConfig, type Plugin } from 'vite';

// The freshness check builds elsewhere and compares, rather than touching the committed bundle.
const outDir = process.env.EDITOR_BUNDLE_OUT_DIR ?? resolve(__dirname, '../../src/web/assets/editor/dist');

function collectNotices(): Plugin {
    return {
        name: 'editor-third-party-notices',
        generateBundle(_options, bundle) {
            const packages = new Map<string, string>();
            const modules = Object.values(bundle).flatMap((output) => (output.type === 'chunk' ? Object.keys(output.modules) : []));

            for (const module of modules) {
                let directory = dirname(module.split('?')[0]);

                if (!isAbsolute(directory)) continue;

                while (directory !== dirname(directory)) {
                    const manifest = join(directory, 'package.json');

                    if (existsSync(manifest)) {
                        const metadata = JSON.parse(readFileSync(manifest, 'utf8'));

                        if (metadata.name && metadata.name !== '@verbb/editor' && !packages.has(metadata.name)) {
                            const notices = readdirSync(directory)
                                .filter((name) => /^(licen[cs]e|notice)(\.|$)/i.test(name) && statSync(join(directory, name)).isFile())
                                .map((name) => readFileSync(join(directory, name), 'utf8'));

                            packages.set(metadata.name, `${metadata.name} ${metadata.version ?? ''}\nLicense declared by package: ${metadata.license ?? 'See package source'}\n${notices.join('\n\n')}`);
                        }

                        break;
                    }

                    directory = dirname(directory);
                }
            }

            this.emitFile({
                type: 'asset',
                fileName: 'THIRD-PARTY-NOTICES.txt',
                source: `Notices for packages included in the Editor browser bundle.\nThese licenses apply only to the corresponding package code.\n\n${[...packages].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value).join('\n\n----------------------------------------\n\n')}\n`,
            });
        },
    };
}

// The bundle Editor ships through Composer: everything in one ES module, including Tiptap, so
// consumers never build or vendor their own copy. Craft publishes it under a hashed path, so the
// filenames stay stable.
export default defineConfig({
    build: {
        outDir,
        emptyOutDir: true,
        cssCodeSplit: false,
        sourcemap: false,
        lib: {
            entry: resolve(__dirname, 'src/bundle.ts'),
            formats: ['es'],
            fileName: () => 'editor.js',
            cssFileName: 'editor',
        },
        rolldownOptions: {
            // Library mode keeps the entry's exports to its own, so the shared core is a chunk of its
            // own that `editor.js` and the feature chunks import. No chunk may import `editor.js`:
            // Craft serves it with a cache-busting query, and the same file at two URLs would run as
            // two copies of Editor and Tiptap.
            preserveEntrySignatures: 'strict',
            output: {
                // Library mode keeps whitespace in ES output so a consumer's bundler can tree-shake
                // it. Nothing bundles these files again, so they're fully minified.
                minify: true,
                // Feature chunks sit beside `editor.js` and load relative to it.
                chunkFileNames: '[name]-[hash].js',
                // Everything `editor.js` shares with a feature, Tiptap included, goes in one core chunk,
                // so `editor.js` waits on one file rather than several.
                advancedChunks: {
                    groups: [{ name: 'core', minShareCount: 2 }],
                },
            },
        },
    },
    plugins: [collectNotices()],
});
