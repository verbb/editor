import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Serves the built bundle and a blank host page. Tests build their own markup and mock endpoints.
const root = fileURLToPath(new URL('../../src/web/assets/editor/dist/', import.meta.url));
const types = { '.js': 'text/javascript', '.css': 'text/css' };
const port = Number(process.argv[2] ?? 4173);

createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;

    if (path === '/health' || path === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Editor</title><link rel="stylesheet" href="/dist/editor.css"></head><body></body></html>');

        return;
    }

    const file = join(root, normalize(path.replace(/^\/dist\//, '')));

    if (!path.startsWith('/dist/') || !file.startsWith(root) || !existsSync(file)) {
        response.writeHead(404);
        response.end();

        return;
    }

    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1');
