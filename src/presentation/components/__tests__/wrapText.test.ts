import { test, expect } from 'bun:test';
import stringWidth from 'string-width';
import { truncateByWidth, wrapByWidth } from '../wrapText.ts';

const widest = (rows: string[]) => Math.max(...rows.map((r) => stringWidth(r)));

test('wraps ASCII at the column boundary', () => {
  expect(wrapByWidth('abcdefgh', 3)).toEqual(['abc', 'def', 'gh']);
});

test('wraps CJK by display width — 2 columns per glyph, never overflowing', () => {
  // Each 汉字 is 2 cols, so a width of 4 holds exactly two of them per row.
  const rows = wrapByWidth('全球体外诊断', 4);
  expect(rows).toEqual(['全球', '体外', '诊断']);
  expect(widest(rows)).toBeLessThanOrEqual(4);
});

test('mixed-width text never exceeds the budget', () => {
  const rows = wrapByWidth('IVD领军企业abc', 6);
  expect(widest(rows)).toBeLessThanOrEqual(6);
  expect(rows.join('')).toBe('IVD领军企业abc'); // lossless
});

test('a single glyph wider than the budget still emits (degenerate width)', () => {
  expect(wrapByWidth('王', 1)).toEqual(['王']); // can't split a glyph; one per row
});

test('empty line stays one empty row; non-positive width passes through', () => {
  expect(wrapByWidth('', 10)).toEqual(['']);
  expect(wrapByWidth('anything', 0)).toEqual(['anything']);
});

test('truncates to a display-width budget and reserves an ellipsis', () => {
  expect(truncateByWidth('abcdefgh', 5)).toBe('abcd…');
  expect(truncateByWidth('全球体外', 5)).toBe('全球…');
  expect(stringWidth(truncateByWidth('全球体外', 5))).toBeLessThanOrEqual(5);
});

test('truncation keeps short text and handles degenerate widths', () => {
  expect(truncateByWidth('abc', 5)).toBe('abc');
  expect(truncateByWidth('abc', 1)).toBe('…');
  expect(truncateByWidth('abc', 0)).toBe('');
});
