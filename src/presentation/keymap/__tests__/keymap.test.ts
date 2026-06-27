import { test, expect, mock } from 'bun:test';
import { deriveContext, footerHints, helpGroups, dispatchKey } from '../keymap.ts';
import type { ContextInput } from '../keymap.ts';
import type { AppState } from '../../app/store.ts';

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
    queryText: '',
    gridDown: mock(() => {}),
    toggleMainTab: mock(() => {}),
    focusPane: mock(() => {}),
    setQuery: mock(() => {}),
    ...over,
  }) as unknown as AppState;

const env = () => ({ quit: mock(() => {}), copy: mock(() => {}) });

test('dispatchKey: ⌃C quits from any context but the editor', () => {
  const e = env();
  dispatchKey(stub({ focus: 'grid' }), key({ name: 'c', ctrl: true }), e);
  expect(e.quit).toHaveBeenCalledTimes(1);
});

test('dispatchKey: ⌃C clears a non-empty editor draft instead of quitting', () => {
  const s = stub({ focus: 'editor', queryText: 'SELECT 1' });
  const e = env();
  dispatchKey(s, key({ name: 'c', ctrl: true }), e);
  expect(e.quit).not.toHaveBeenCalled();
  expect(s.setQuery).toHaveBeenCalledWith('');
});

test('dispatchKey: ⌃C on an already-empty editor quits', () => {
  const s = stub({ focus: 'editor', queryText: '' });
  const e = env();
  dispatchKey(s, key({ name: 'c', ctrl: true }), e);
  expect(s.setQuery).not.toHaveBeenCalled();
  expect(e.quit).toHaveBeenCalledTimes(1);
});

test('dispatchKey: a grid key runs its bound action', () => {
  const s = stub();
  dispatchKey(s, key({ name: 'j', sequence: 'j' }), env());
  expect(s.gridDown).toHaveBeenCalledTimes(1);
});

test('dispatchKey: in the editor, glyphs are left to the native input', () => {
  // The SQL <input> owns typing; the dispatcher must not treat : / q as commands
  // (no focusPane, no quit) nor sync the store itself — the input's onInput does.
  const s = stub({ focus: 'editor' });
  const e = env();
  dispatchKey(s, key({ sequence: ':' }), e);
  dispatchKey(s, key({ name: 'q', sequence: 'q' }), e);
  expect(s.focusPane).not.toHaveBeenCalled();
  expect(s.setQuery).not.toHaveBeenCalled();
  expect(e.quit).not.toHaveBeenCalled();
});

test('dispatchKey: y in the cell inspector copies the full value', () => {
  // The inspector owns input (cellView set → 'cell' context); y yanks the whole
  // formatted value to the injected clipboard, not the truncated on-screen slice.
  const s = stub({ cellView: { column: 'name', value: 'gamma', offset: 0 } } as Partial<AppState>);
  const e = env();
  dispatchKey(s, key({ name: 'y', sequence: 'y' }), e);
  expect(e.copy).toHaveBeenCalledTimes(1);
  expect(e.copy).toHaveBeenCalledWith('gamma');
});

test('dispatchKey: the DDL context only answers the tab toggle', () => {
  const s = stub({ mainTab: 'ddl' });
  dispatchKey(s, key({ name: 'j', sequence: 'j' }), env()); // swallowed, no nav
  expect(s.gridDown).not.toHaveBeenCalled();
  dispatchKey(s, key({ sequence: 'D' }), env());
  expect(s.toggleMainTab).toHaveBeenCalledTimes(1);
});

test('dispatchKey: g/G jump the tree to its first / last row', () => {
  const treeTop = mock(() => {});
  const treeBottom = mock(() => {});
  const s = stub({ focus: 'sidebar', treeTop, treeBottom } as Partial<AppState>);
  dispatchKey(s, key({ name: 'g', sequence: 'g' }), env());
  dispatchKey(s, key({ name: 'G', sequence: 'G' }), env());
  expect(treeTop).toHaveBeenCalledTimes(1);
  expect(treeBottom).toHaveBeenCalledTimes(1);
});

test('dispatchKey: ⌃l focuses the results pane, from a nav context and the editor', () => {
  const fromGrid = stub({ focus: 'grid' });
  dispatchKey(fromGrid, key({ name: 'l', ctrl: true }), env());
  expect(fromGrid.focusPane).toHaveBeenCalledWith('grid');

  const fromEditor = stub({ focus: 'editor' });
  dispatchKey(fromEditor, key({ name: 'l', ctrl: true }), env());
  expect(fromEditor.focusPane).toHaveBeenCalledWith('grid');
});

test('dispatchKey: the removed 1/2/3 pane-jump no longer fires', () => {
  const s = stub({ focus: 'grid' });
  for (const d of ['1', '2', '3']) dispatchKey(s, key({ sequence: d }), env());
  expect(s.focusPane).not.toHaveBeenCalled();
});
