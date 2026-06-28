#!/usr/bin/env bun
/**
 * Build the npm release artifacts under dist/npm/:
 *   - one platform sub-package per target (`@vascent/lazysql-<os>-<arch>`), each a
 *     `bun --compile` standalone binary tagged with npm `os`/`cpu` so npm installs
 *     only the matching one;
 *   - the slim main package (`@vascent/lazysql`), whose bin shim execs the binary,
 *     depending on all platforms via optionalDependencies.
 *
 * OpenTUI ships per-platform native modules, so a binary can ONLY be compiled on
 * its own platform — CI runs this once per OS runner with --target, then once with
 * --main-only on the publish job after collecting every sub-package.
 *
 * Usage:
 *   bun scripts/build-npm.ts                 # current platform sub-package + main (local check)
 *   bun scripts/build-npm.ts --target=linux-x64   # one platform sub-package
 *   bun scripts/build-npm.ts --main-only     # main package only
 */

import { mkdirSync, rmSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Target {
  readonly suffix: string; // npm sub-package suffix, also <platform>-<arch>
  readonly bunTarget: string; // bun --compile --target value
  readonly os: string; // npm `os` field
  readonly cpu: string; // npm `cpu` field
  readonly binName: string; // file name inside bin/
}

const TARGETS: readonly Target[] = [
  { suffix: 'darwin-arm64', bunTarget: 'bun-darwin-arm64', os: 'darwin', cpu: 'arm64', binName: 'lazysql' },
  { suffix: 'darwin-x64', bunTarget: 'bun-darwin-x64', os: 'darwin', cpu: 'x64', binName: 'lazysql' },
  { suffix: 'linux-x64', bunTarget: 'bun-linux-x64', os: 'linux', cpu: 'x64', binName: 'lazysql' },
  { suffix: 'linux-arm64', bunTarget: 'bun-linux-arm64', os: 'linux', cpu: 'arm64', binName: 'lazysql' },
  { suffix: 'win32-x64', bunTarget: 'bun-windows-x64', os: 'win32', cpu: 'x64', binName: 'lazysql.exe' },
];

const ROOT = join(import.meta.dir, '..');
const OUT = join(ROOT, 'dist', 'npm');
const SCOPE = '@vascent';

interface RootPkg {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly license?: string;
}
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as RootPkg;
const VERSION = pkg.version;
const LICENSE = pkg.license ?? 'MIT';

const writeJson = (path: string, value: unknown): void =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

/** Compile the standalone binary for `t` and write its sub-package. */
const buildSubPackage = (t: Target): void => {
  const dir = join(OUT, t.suffix);
  const binDir = join(dir, 'bin');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(binDir, { recursive: true });

  // bun appends `.exe` for windows targets; pass the base name so the produced
  // file matches `binName`.
  const outBase = join(binDir, t.binName.replace(/\.exe$/, ''));
  const proc = Bun.spawnSync(
    ['bun', 'build', join(ROOT, 'src', 'main.tsx'), '--compile', `--target=${t.bunTarget}`, '--outfile', outBase],
    { cwd: ROOT, stdio: ['inherit', 'inherit', 'inherit'] },
  );
  if (proc.exitCode !== 0) throw new Error(`compile failed for ${t.suffix}`);

  writeJson(join(dir, 'package.json'), {
    name: `${SCOPE}/lazysql-${t.suffix}`,
    version: VERSION,
    description: `lazysql prebuilt binary for ${t.suffix}`,
    license: LICENSE,
    os: [t.os],
    cpu: [t.cpu],
    files: ['bin'],
    publishConfig: { access: 'public' },
  });
  console.log(`✓ sub-package ${SCOPE}/lazysql-${t.suffix}`);
};

/** Write the slim main package (shim + manifest depending on every platform). */
const buildMainPackage = (): void => {
  const dir = join(OUT, 'main');
  const binDir = join(dir, 'bin');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(binDir, { recursive: true });
  copyFileSync(join(ROOT, 'bin', 'lazysql.cjs'), join(binDir, 'lazysql.cjs'));
  copyFileSync(join(ROOT, 'README.md'), join(dir, 'README.md'));

  const optionalDependencies = Object.fromEntries(
    TARGETS.map((t) => [`${SCOPE}/lazysql-${t.suffix}`, VERSION]),
  );
  writeJson(join(dir, 'package.json'), {
    name: pkg.name,
    version: VERSION,
    description: pkg.description,
    license: LICENSE,
    bin: { lazysql: 'bin/lazysql.cjs' },
    optionalDependencies,
    files: ['bin'],
    publishConfig: { access: 'public' },
  });
  console.log(`✓ main package ${pkg.name}`);
};

const args = new Set(Bun.argv.slice(2));
const targetArg = [...args].find((a) => a.startsWith('--target='))?.split('=')[1];

mkdirSync(OUT, { recursive: true });
if (args.has('--main-only')) {
  buildMainPackage();
} else if (targetArg) {
  const t = TARGETS.find((x) => x.suffix === targetArg);
  if (!t) throw new Error(`unknown target: ${targetArg} (known: ${TARGETS.map((x) => x.suffix).join(', ')})`);
  buildSubPackage(t);
} else {
  // No args: build the current platform + main, for a local smoke test.
  const here = `${process.platform}-${process.arch}`;
  const t = TARGETS.find((x) => x.suffix === here);
  if (!t) throw new Error(`no target for the current platform (${here})`);
  buildSubPackage(t);
  buildMainPackage();
}
