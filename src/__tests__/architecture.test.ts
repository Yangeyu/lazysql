/**
 * Architecture gates (CLAUDE.md appendix) — the rules that keep the layering
 * honest, enforced mechanically instead of by review vigilance:
 *
 *   1. Dependency direction: domain/ and application/ never import adapters,
 *      presentation, or any concrete DB/LLM/TUI package. (DIP — the single
 *      highest-leverage check in the repo.)
 *   2. Named exports only — no `export default` anywhere under src/.
 *   3. The TUI owns stdout: no global console.* in src/ (main.tsx's pre-renderer
 *      meta commands and test files are the deliberate exceptions).
 *   4. Store-slice discipline: a slice under presentation/app/slices/ never
 *      imports a sibling slice, and reaches store.ts for TYPES only — slices
 *      talk through the root's ctx or get().action(), never to each other.
 *
 * On failure the assertion message lists every offending file:line.
 */

import { test, expect } from 'bun:test';
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const sources = [...new Glob('src/**/*.{ts,tsx}').scanSync(ROOT)].sort();

const isTest = (f: string): boolean => f.includes('__tests__');

/** Every `file:line  text` in `files` whose line matches `pattern`. */
const offending = (pattern: RegExp, files: readonly string[]): string[] =>
  files.flatMap((f) =>
    readFileSync(join(ROOT, f), 'utf8')
      .split('\n')
      .flatMap((line, i) => (pattern.test(line) ? [`${f}:${i + 1}  ${line.trim()}`] : [])),
  );

test('domain/ and application/ import nothing from the outer layers', () => {
  const inner = sources.filter(
    (f) => (f.startsWith('src/domain/') || f.startsWith('src/application/')) && !isTest(f),
  );
  const outward =
    /from\s+['"](?:[^'"]*\/(?:adapters|presentation)\/|mysql2|mongodb|bun:sqlite|@anthropic-ai|openai|@opentui|react|zustand|yaml)/;
  expect(offending(outward, inner)).toEqual([]);
});

test('no export default anywhere under src/', () => {
  expect(offending(/^\s*export\s+default\b/, sources)).toEqual([]);
});

test('no global console.* outside main.tsx and tests (the TUI owns stdout)', () => {
  const files = sources.filter((f) => !isTest(f) && f !== 'src/main.tsx');
  expect(offending(/(?<![.\w])console\.(?:log|warn|error|info|debug|trace)\(/, files)).toEqual([]);
});

test('store slices never import each other, and import store.ts as types only', () => {
  const slices = sources.filter(
    (f) => f.startsWith('src/presentation/app/slices/') && !isTest(f),
  );
  // A sibling slice import ('./browse.ts' etc.) — value or type, both banned:
  // even a type dependency couples two slices' shapes behind the root's back.
  const sibling = /from\s+['"]\.\/(?!.*\bstore\b)[^'"]+['"]/;
  // A VALUE import from the root ('../store.ts') — `import type` is the one
  // sanctioned handshake (the AppState contract); values would be a cycle.
  const rootValue = /^\s*import\s+(?!type\b)[^'"]*from\s+['"]\.\.\/store\.ts['"]/;
  expect([...offending(sibling, slices), ...offending(rootValue, slices)]).toEqual([]);
});
