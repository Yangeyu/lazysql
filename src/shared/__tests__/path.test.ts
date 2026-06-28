import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveUserPath } from '../path.ts';

describe('resolveUserPath', () => {
  test('makes a relative path absolute against cwd', () => {
    expect(resolveUserPath('data/sample.db')).toBe(resolve('data/sample.db'));
  });

  test('leaves an absolute path unchanged', () => {
    expect(resolveUserPath('/var/db/x.db')).toBe('/var/db/x.db');
  });

  test('expands a leading ~ to the home dir', () => {
    expect(resolveUserPath('~/db/x.db')).toBe(join(homedir(), 'db/x.db'));
    expect(resolveUserPath('~')).toBe(homedir());
  });

  test('passes through empty and :memory: untouched', () => {
    expect(resolveUserPath('')).toBe('');
    expect(resolveUserPath(':memory:')).toBe(':memory:');
  });
});
