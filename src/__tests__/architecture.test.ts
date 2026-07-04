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
