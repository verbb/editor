#!/usr/bin/env node
/**
 * Keeps `@verbb/editor` on the same version as the `verbb/editor` Composer package, because the
 * browser and PHP halves of one release must agree.
 *
 *   node scripts/release-version.mjs              Check the versions match.
 *   node scripts/release-version.mjs --publishable  Also refuse a development version, before publishing.
 *   node scripts/release-version.mjs 1.0.0         Set every version for review, then check them.
 *
 * It never publishes, commits, tags or pushes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = {
    composer: `${root}composer.json`,
    workspace: `${root}package.json`,
    package: `${root}packages/editor/package.json`,
    lockfile: `${root}package-lock.json`,
};
const args = process.argv.slice(2);
const publishable = args.includes('--publishable');
const target = args.find((arg) => !arg.startsWith('--'));

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
// Each file keeps its own indentation, so the diff shows only the version.
const write = (path, data) => {
    const indent = readFileSync(path, 'utf8').match(/^\{\r?\n([ \t]+)"/)?.[1] ?? '    ';

    writeFileSync(path, `${JSON.stringify(data, null, indent)}\n`);
};

if (target !== undefined) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(target)) {
        throw new Error(`"${target}" isn't a version such as 1.0.0 or 1.1.0-beta.1.`);
    }

    const composer = read(files.composer);
    const workspace = read(files.workspace);
    const pkg = read(files.package);
    const lockfile = read(files.lockfile);

    composer.version = target;
    workspace.version = target;
    pkg.version = target;
    lockfile.version = target;
    lockfile.packages[''].version = target;
    lockfile.packages['packages/editor'].version = target;

    write(files.composer, composer);
    write(files.workspace, workspace);
    write(files.package, pkg);
    write(files.lockfile, lockfile);
    console.log(`Set verbb/editor and @verbb/editor to ${target}. Review the diff; nothing was published.`);
}

const lockfile = read(files.lockfile);
const versions = {
    'composer.json': read(files.composer).version,
    'package.json': read(files.workspace).version,
    'packages/editor/package.json': read(files.package).version,
    'package-lock.json': lockfile.version,
    'package-lock.json (packages/editor)': lockfile.packages['packages/editor']?.version,
};
const expected = versions['composer.json'];
const mismatched = Object.entries(versions).filter(([, version]) => version !== expected);

if (!expected) {
    throw new Error('composer.json has no version, so there is nothing for @verbb/editor to follow.');
}

if (mismatched.length) {
    throw new Error(`Versions aren't in lockstep with composer.json (${expected}):\n${mismatched.map(([file, version]) => `  ${file}: ${version}`).join('\n')}`);
}

if (publishable && /-dev$/.test(expected)) {
    throw new Error(`${expected} is a development version. Set the release version first: node scripts/release-version.mjs <version>`);
}

console.log(`PASS: verbb/editor and @verbb/editor are both ${expected}.`);
