import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
    build: {
        lib: {
            // GIF search is an entry of its own, so a host without the editor loads it alone.
            entry: {
                index: resolve(__dirname, 'src/index.ts'),
                gifs: resolve(__dirname, 'src/gifs/index.ts'),
            },
            formats: ['es'],
            fileName: (_format, name) => `${name}.js`,
        },
        rollupOptions: {
            external: [
                /^@tiptap\//,
            ],
        },
        cssCodeSplit: true,
        sourcemap: true,
    },
    plugins: [
        {
            name: 'editor-theme-exports',
            generateBundle() {
                for (const theme of ['light', 'dark', 'craft', 'none']) {
                    this.emitFile({
                        type: 'asset',
                        fileName: `themes/${theme}.css`,
                        source: readFileSync(resolve(__dirname, `src/styles/${theme}.css`), 'utf8'),
                    });
                }

                // Consumers shouldn't each need their own shim to import a stylesheet.
                this.emitFile({ type: 'asset', fileName: 'styles.d.ts', source: 'export {};\n' });
            },
        },
        dts({
            tsconfigPath: resolve(__dirname, 'tsconfig.build.json'),
            entryRoot: resolve(__dirname, 'src'),
            include: ['src'],
            // Node's own resolution (`moduleResolution: node16` or `nodenext`) needs the extension on
            // every relative import, or a consumer's types silently become `any`.
            beforeWriteFile: (filePath, content) => ({
                filePath,
                content: content.replace(/((?:from|import)\s*\(?\s*['"])(\.{1,2}\/[^'"]+?)(['"])/g, (match, before, specifier, after) => (
                    /\.(js|css)$/.test(specifier) ? match : `${before}${specifier}.js${after}`
                )),
            }),
        }),
    ],
});
