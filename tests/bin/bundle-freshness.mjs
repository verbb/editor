import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Consumers load the committed bundle, so it must match the source that produced it.
const root = fileURLToPath(new URL('../../', import.meta.url));
const committed = join(root, 'src/web/assets/editor/dist');
const fresh = mkdtempSync(join(tmpdir(), 'editor-bundle-'));

try {
    const build = spawnSync('npm', ['run', 'build:bundle'], { cwd: root, encoding: 'utf8', env: { ...process.env, EDITOR_BUNDLE_OUT_DIR: fresh } });

    assert.equal(build.status, 0, build.stderr || build.stdout);
    assert.deepEqual(readdirSync(fresh).sort(), readdirSync(committed).sort(), 'The committed bundle has different files. Run `npm run build:bundle`.');

    for (const file of readdirSync(fresh)) {
        assert.ok(readFileSync(join(fresh, file)).equals(readFileSync(join(committed, file))), `${file} is stale. Run \`npm run build:bundle\`.`);
    }

    console.log('PASS: the committed browser bundle matches its source.');
} finally {
    rmSync(fresh, { recursive: true, force: true });
}
