import { test, expect } from 'bun:test';
import { deriveContext, footerHints, helpGroups } from '../keymap.ts';
import type { ContextInput } from '../keymap.ts';

const base: ContextInput = {
  cellView: null,
  mode: 'normal',
  nlMode: false,
  focus: 'grid',
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
