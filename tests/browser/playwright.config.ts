import { defineConfig } from '@playwright/test';

/**
 * Real-browser tests against the bundle consumers load. `npm run build:bundle` first. The `e2e`
 * project also needs the disposable Craft test install: set EDITOR_E2E=1 to include it.
 */
const e2e = process.env.EDITOR_E2E === '1';
const staticPort = 4173;
const craftPort = 4174;

export default defineConfig({
    testDir: '.',
    outputDir: '../../.cache/playwright',
    fullyParallel: false,
    workers: 1,
    reporter: 'line',
    use: {
        baseURL: `http://127.0.0.1:${staticPort}`,
        browserName: 'chromium',
    },
    projects: [
        { name: 'browser', testIgnore: /e2e\.spec\.ts/ },
        ...(e2e ? [{ name: 'e2e', testMatch: /e2e\.spec\.ts/, use: { baseURL: `http://127.0.0.1:${craftPort}` } }] : []),
    ],
    webServer: [
        {
            command: `node tests/browser/server.mjs ${staticPort}`,
            cwd: '../..',
            url: `http://127.0.0.1:${staticPort}/health`,
            reuseExistingServer: false,
        },
        ...(e2e ? [{
            command: `php -S 127.0.0.1:${craftPort} -t tests/_craft/web tests/bin/http-router.php`,
            cwd: '../..',
            url: `http://127.0.0.1:${craftPort}/__dist/editor.css`,
            reuseExistingServer: false,
        }] : []),
    ],
});
