import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Packs `@verbb/editor` as npm would publish it and checks the tarball on its own: the files, every
 * export, the licence, the version against Composer's, an import in Node with no DOM, and the
 * types from a TypeScript consumer under both bundler and Node resolution. `npm run build` first.
 * It stands in for publint and attw, which aren't installed here.
 */
const root = fileURLToPath(new URL('../../', import.meta.url));
const packageDir = join(root, 'packages/editor');
const work = mkdtempSync(join(tmpdir(), 'editor-pack-'));

try {
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work], { cwd: packageDir, encoding: 'utf8' }));
    const files = packed.files.map((file) => file.path).sort();
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    const composer = JSON.parse(readFileSync(join(root, 'composer.json'), 'utf8'));

    assert.equal(packed.name, '@verbb/editor');
    assert.equal(packed.version, composer.version, 'The npm version must follow verbb/editor in composer.json.');
    assert.equal(manifest.license, 'MIT');
    assert.equal(manifest.type, 'module');
    assert.deepEqual(manifest.sideEffects, ['*.css'], 'Only stylesheets have side effects, so bundlers can drop unused code.');

    for (const required of ['README.md', 'LICENSE.md', 'package.json', 'dist/index.js', 'dist/index.d.ts', 'dist/index.css']) {
        assert.ok(files.includes(required), `The tarball is missing ${required}.`);
    }

    for (const file of files) {
        assert.ok(['README.md', 'LICENSE.md', 'package.json'].includes(file) || file.startsWith('dist/'), `${file} shouldn't be published.`);
        assert.ok(!/(^|\/)(src|tests?|node_modules)\//.test(file) && !file.endsWith('.tsbuildinfo'), `${file} shouldn't be published.`);
    }

    // Every export, and `types` first in each, so TypeScript reads it before a runtime condition.
    const targets = [manifest.types];

    for (const [subpath, entry] of Object.entries(manifest.exports)) {
        if (typeof entry === 'string') {
            targets.push(entry);
            continue;
        }

        assert.equal(Object.keys(entry)[0], 'types', `The "${subpath}" export must list types first.`);
        targets.push(...Object.values(entry));
    }

    for (const target of targets) {
        assert.ok(files.includes(target.replace(/^\.\//, '')), `${target} is exported but not in the tarball.`);
    }

    // Unpack beside a consumer that resolves the tarball, with the package's own dependencies.
    const consumer = join(work, 'consumer');
    const installed = join(consumer, 'node_modules/@verbb/editor');

    mkdirSync(installed, { recursive: true });
    execFileSync('tar', ['-xzf', join(work, packed.filename), '-C', installed, '--strip-components=1']);
    assert.equal(readFileSync(join(installed, 'LICENSE.md'), 'utf8'), readFileSync(join(root, 'LICENSE.md'), 'utf8'), 'LICENSE.md must match the library licence.');

    for (const dependency of ['@tiptap', 'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-transform']) {
        const source = join(root, 'node_modules', dependency);

        if (existsSync(source)) symlinkSync(source, join(consumer, 'node_modules', dependency));
    }

    for (const dependency of Object.keys(manifest.dependencies)) {
        assert.ok(existsSync(join(consumer, 'node_modules', dependency)), `${dependency} couldn't be linked for the consumer.`);
    }

    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'editor-pack-consumer', private: true, type: 'module' }));

    // A server render imports the package with no DOM.
    const exports = execFileSync(process.execPath, ['--input-type=module', '-e', "import('@verbb/editor').then((module) => console.log(JSON.stringify(Object.keys(module).sort())))"], { cwd: consumer, encoding: 'utf8' });

    assert.deepEqual(JSON.parse(exports), ['Editor', 'Tiptap', 'VerbbEditorElement', 'VerbbEditorInputElement', 'loadFeatures', 'registerVerbbEditorElement', 'registerVerbbEditorInputElement']);

    const source = readFileSync(join(root, 'tests/package/consumer.ts'), 'utf8');
    const tsc = join(root, 'node_modules/typescript/bin/tsc');

    for (const [resolution, module, file] of [['Bundler', 'ESNext', 'consumer.ts'], ['NodeNext', 'NodeNext', 'consumer.mts']]) {
        writeFileSync(join(consumer, file), source);
        writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({
            compilerOptions: { target: 'ES2022', module, moduleResolution: resolution, strict: true, noEmit: true, types: [], lib: ['ES2022', 'DOM', 'DOM.Iterable'] },
            files: [file],
        }));

        try {
            execFileSync(process.execPath, [tsc, '--project', join(consumer, 'tsconfig.json')], { cwd: consumer, encoding: 'utf8' });
        } catch (error) {
            assert.fail(`The packed types don't resolve under ${resolution}:\n${error.stdout}`);
        }

        rmSync(join(consumer, file));
    }

    console.log(`PASS: ${packed.filename} holds ${files.length} files, every export, the licence and types for bundler and Node resolution.`);
} finally {
    rmSync(work, { recursive: true, force: true });
}
