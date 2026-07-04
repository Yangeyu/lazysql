#!/usr/bin/env bun
/**
 * Cut a release locally: verify a clean tree, run the DONE gate (typecheck +
 * tests), bump package.json, regenerate CHANGELOG.md via git-cliff, then
 * commit `chore(repo): release vX.Y.Z` and create the `vX.Y.Z` tag.
 *
 * Publishing stays in CI: `git push --follow-tags` triggers
 * .github/workflows/release.yml (npm publish + GitHub Release notes).
 *
 * Usage:
 *   bun scripts/release.ts [patch|minor|major|<x.y.z>]   # default: patch
 *   bun scripts/release.ts minor --skip-checks           # skip typecheck+test gate
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $ } from 'bun';

const ROOT = join(import.meta.dir, '..');
const PKG_PATH = join(ROOT, 'package.json');

const args = process.argv.slice(2);
const skipChecks = args.includes('--skip-checks');
const bumpArg = args.find((a) => !a.startsWith('--')) ?? 'patch';

function nextVersion(current: string, bump: string): string {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`current version "${current}" is not x.y.z`);
  }
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`unknown bump "${bump}" — use patch|minor|major|x.y.z`);
  }
}

$.cwd(ROOT);

const dirty = (await $`git status --porcelain`.text()).trim();
if (dirty !== '') {
  console.error('working tree is not clean — the release commit must contain only the version bump and changelog:\n' + dirty);
  process.exit(1);
}

if (!skipChecks) {
  await $`bun run typecheck`;
  await $`bun test`;
}

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8')) as { version: string };
const version = nextVersion(pkg.version, bumpArg);
const tag = `v${version}`;

const existing = (await $`git tag -l ${tag}`.text()).trim();
if (existing !== '') {
  console.error(`tag ${tag} already exists`);
  process.exit(1);
}

writeFileSync(PKG_PATH, readFileSync(PKG_PATH, 'utf8').replace(`"version": "${pkg.version}"`, `"version": "${version}"`));
await $`bunx git-cliff --tag ${tag} -o CHANGELOG.md`;

await $`git add package.json CHANGELOG.md`;
await $`git commit -m ${'chore(repo): release ' + tag}`;
await $`git tag ${tag}`;

console.log(`\nreleased ${tag} locally. To publish (npm + GitHub Release via CI):\n\n  git push --follow-tags\n`);
