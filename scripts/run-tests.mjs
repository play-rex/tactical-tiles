// Bundles each *.test.ts under the given directory with esbuild and runs it with node:test.
// Bundling lets the sources keep extensionless imports, which plain Node can't resolve.
import { buildSync } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'test');
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : f.endsWith('.test.ts') ? [p] : [];
});
const entries = walk(dir);
const out = mkdtempSync(join(tmpdir(), 'tt-tests-'));
try {
  buildSync({
    entryPoints: entries,
    bundle: true,
    platform: 'node',
    format: 'esm',
    outdir: out,
    outExtension: { '.js': '.mjs' },
    logLevel: 'warning',
  });
  const files = readdirSync(out).filter((f) => f.endsWith('.mjs')).map((f) => join(out, f));
  const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
