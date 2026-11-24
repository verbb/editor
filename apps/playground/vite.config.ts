import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
    root: resolve(__dirname),
    server: {
        port: 4173,
    },
});
