import { test, expect } from 'bun:test';
import { parseArgs } from '../parse.ts';

test('no args → the interactive picker', () => {
  expect(parseArgs([])).toEqual({ kind: 'default' });
});

test('a bare token is an open target (name or file — resolved later, at the edge)', () => {
  expect(parseArgs(['prod-pg'])).toEqual({ kind: 'open', target: 'prod-pg' });
  expect(parseArgs(['data/sample.db'])).toEqual({ kind: 'open', target: 'data/sample.db' });
});

test('-l / --list map to the list intent', () => {
  expect(parseArgs(['-l'])).toEqual({ kind: 'list' });
  expect(parseArgs(['--list'])).toEqual({ kind: 'list' });
});

test('-h / --help map to help, wherever they appear', () => {
  expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
  expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
  // A meta-flag after a positional still wins (GNU-ish).
  expect(parseArgs(['prod-pg', '--help'])).toEqual({ kind: 'help' });
});

test('-v / --version map to version', () => {
  expect(parseArgs(['-v'])).toEqual({ kind: 'version' });
  expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
});

test('help takes precedence over version when both are present', () => {
  expect(parseArgs(['--version', '--help'])).toEqual({ kind: 'help' });
});

test('an unrecognised flag is a usage error distinct from an open target', () => {
  expect(parseArgs(['--nope'])).toEqual({ kind: 'unknownOption', option: '--nope' });
  expect(parseArgs(['-x'])).toEqual({ kind: 'unknownOption', option: '-x' });
});
