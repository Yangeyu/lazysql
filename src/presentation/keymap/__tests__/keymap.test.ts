import { test, expect, mock } from 'bun:test';
import { deriveContext, footerHints, helpGroups, dispatchKey } from '../keymap.ts';
import type { ContextInput } from '../keymap.ts';
import type { AppState } from '../../app/store.ts';
import { field, type TextField } from '../../input/textField.ts';

const base: ContextInput = {
  cellView: null,
  mode: 'normal',
  nlMode: false,
  focus: 'grid',
  surface: 'browse',
  mainTab: 'data',
};

test('deriveContext follows a strict precedence: cell inspector wins over everything', () => {
  expect(deriveContext({ ...base, cellView: {}, mode: 'edit', nlMode: true })).toBe('cell');
});

test('deriveContext ranks the input modes above the NL prompt and pane focus', () => {
  expect(deriveContext({ ...base, mode: 'connform' })).toBe('connform');
  expect(deriveContext({ ...base, mode: 'filter' })).toBe('filter');
  expect(deriveContext({ ...base, mode: 'edit' })).toBe('edit');
  expect(deriveContext({ ...base, mode: 'confirm' })).toBe('confirm');
  expect(deriveContext({ ...base, nlMode: true, focus: 'editor' })).toBe('nl');
});

test('deriveContext falls back to plain pane focus', () => {
  expect(deriveContext({ ...base, focus: 'editor' })).toBe('editor');
  expect(deriveContext({ ...base, focus: 'sidebar' })).toBe('sidebar');
  expect(deriveContext({ ...base, focus: 'grid' })).toBe('grid');
});

test('footerHints and helpGroups read the same registry for a context', () => {
  const flags = { queryable: true, nlAvailable: true };
  expect(footerHints('grid', flags)).toContain('sort');
  expect(helpGroups('grid', flags)[0]?.title).toBe('Data grid');
});

test('footerHints lists each binding once and omits globals while typing', () => {
  const flags = { queryable: true, nlAvailable: true };
  // The table repeats a row per match alternative (up AND k) — the footer dedupes.
  expect(footerHints('grid', flags).match(/row/g)?.length).toBe(1);
  // The editor captures text, so q/`/: are NOT advertised (they're literal there).
  expect(footerHints('editor', flags)).not.toContain('quit');
  expect(footerHints('grid', flags)).toContain('quit');
});

// ── dispatchKey: behaviour now comes from the same table ──

const key = (over: Record<string, unknown> = {}) =>
  ({ name: '', ctrl: false, meta: false, option: false, sequence: '', ...over }) as never;

const stub = (over: Partial<AppState> = {}): AppState =>
  ({
    helpOpen: false,
    generating: false,
    queryable: true,
    nlAvailable: true,
    cellView: null,
    mode: 'normal',
    nlMode: false,
    focus: 'grid',
    surface: 'browse',
    mainTab: 'data',
    completions: [],
    queryText: field(''),
    gridDown: mock(() => {}),
    toggleMainTab: mock(() => {}),
    focusPane: mock(() => {}),
    editQuery: mock(() => {}),
    ...over,
  }) as unknown as AppState;

const env = () => ({ quit: mock(() => {}) });

test('dispatchKey: ⌃C quits from any context', () => {
  const e = env();
  dispatchKey(stub({ focus: 'editor' }), key({ name: 'c', ctrl: true }), e);
  expect(e.quit).toHaveBeenCalledTimes(1);
});

test('dispatchKey: a grid key runs its bound action', () => {
  const s = stub();
  dispatchKey(s, key({ name: 'j', sequence: 'j' }), env());
  expect(s.gridDown).toHaveBeenCalledTimes(1);
});

test('dispatchKey: in the editor, global glyphs are literal text, not commands', () => {
  // Capture what each edit op would insert into an empty field.
  const typed: string[] = [];
  const s = stub({
    focus: 'editor',
    editQuery: ((op: (tf: TextField) => TextField) => typed.push(op(field('')).value)) as never,
  });
  const e = env();
  dispatchKey(s, key({ sequence: ':' }), e); // not focusPane
  dispatchKey(s, key({ name: 'q', sequence: 'q' }), e); // not quit
  expect(typed).toEqual([':', 'q']);
  expect(s.focusPane).not.toHaveBeenCalled();
  expect(e.quit).not.toHaveBeenCalled();
});

test('dispatchKey: the DDL context only answers the tab toggle', () => {
  const s = stub({ mainTab: 'ddl' });
  dispatchKey(s, key({ name: 'j', sequence: 'j' }), env()); // swallowed, no nav
  expect(s.gridDown).not.toHaveBeenCalled();
  dispatchKey(s, key({ sequence: 'D' }), env());
  expect(s.toggleMainTab).toHaveBeenCalledTimes(1);
});
