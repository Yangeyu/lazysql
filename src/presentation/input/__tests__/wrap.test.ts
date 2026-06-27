import { test, expect } from 'bun:test';
import { wrapWithCursor } from '../wrap.ts';

test('wrap keeps every character (lines rejoin to the value)', () => {
  const { lines } = wrapWithCursor('select id from users', 0, 8);
  expect(lines.join('')).toBe('select id from users');
});

test('a cursor at the end lands on the last line', () => {
  const v = 'select id from users';
  const { lines, caretLine, caretCol } = wrapWithCursor(v, v.length, 8);
  expect(caretLine).toBe(lines.length - 1);
  expect(caretCol).toBe(lines[caretLine]!.length);
});

test('a mid-string cursor maps onto the right line and column', () => {
  // 'select ' is 7 chars; wrapping at 8 keeps it on line 0.
  const { lines, caretLine, caretCol } = wrapWithCursor('select id from users', 3, 8);
  expect(caretLine).toBe(0);
  expect(caretCol).toBe(3);
  expect(lines[0]!.slice(0, caretCol)).toBe('sel');
});

test('an over-long word hard-breaks and the cursor follows', () => {
  const { lines, caretLine, caretCol } = wrapWithCursor('abcdefghij', 9, 4);
  expect(lines.join('')).toBe('abcdefghij');
  // 10 chars / width 4 → lines of 4,4,2; char 9 is on the third line.
  expect(caretLine).toBe(2);
  expect(caretCol).toBe(1);
});

test('an empty value still yields one line with the cursor at the start', () => {
  expect(wrapWithCursor('', 0, 10)).toMatchObject({ lines: [''], caretLine: 0, caretCol: 0 });
});
