/**
 * The system clipboard adapter's platform mapping — pure, so it's checked without
 * spawning a process. The spawn itself (write) is a thin, best-effort shim.
 */

import { test, expect } from 'bun:test';
import { clipboardCommand } from '../SystemClipboard.ts';

test('clipboardCommand picks the platform clipboard CLI', () => {
  expect(clipboardCommand('darwin')).toEqual(['pbcopy']);
  expect(clipboardCommand('linux')).toEqual(['xclip', '-selection', 'clipboard']);
  expect(clipboardCommand('win32')).toEqual(['clip']);
});

test('clipboardCommand is null on an unsupported platform', () => {
  expect(clipboardCommand('aix' as NodeJS.Platform)).toBeNull();
});
