#!/usr/bin/env node
/**
 * Thin launcher for the published npm package. The real program is a
 * self-contained `bun --compile` binary, shipped per-platform as an optional
 * dependency (@yangeyu/lazysql-<os>-<arch>); npm installs only the one matching
 * the host. This shim resolves that binary and execs it, forwarding argv and the
 * exit code. It runs under plain Node — no Bun required on the user's machine.
 */

const { spawnSync } = require('node:child_process');

const platformArch = `${process.platform}-${process.arch}`;
const binName = process.platform === 'win32' ? 'lazysql.exe' : 'lazysql';

let binaryPath;
try {
  binaryPath = require.resolve(`@yangeyu/lazysql-${platformArch}/bin/${binName}`);
} catch {
  console.error(`lazysql: no prebuilt binary for ${platformArch}.`);
  console.error(
    'Supported platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64.',
  );
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  console.error(`lazysql: failed to launch — ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
