import { test, expect } from 'bun:test';
import { formatCellValue } from './cellFormat.ts';

test('pretty-prints JSON object text across multiple lines', () => {
  const { type, lines } = formatCellValue('{"a":1,"b":[2,3]}');
  expect(type).toBe('json');
  expect(lines.length).toBeGreaterThan(1);
  expect(lines[0]).toBe('{');
  expect(lines.join('\n')).toContain('"a": 1');
});

test('treats invalid JSON-looking text as plain text', () => {
  const { type, lines } = formatCellValue('{not json');
  expect(type).toContain('text');
  expect(lines).toEqual(['{not json']);
});

test('splits multi-line text into lines', () => {
  expect(formatCellValue('a\nb\nc').lines).toEqual(['a', 'b', 'c']);
});

test('null and scalars are labelled by type', () => {
  expect(formatCellValue(null).type).toBe('null');
  expect(formatCellValue(42).type).toBe('number');
  expect(formatCellValue(42).lines).toEqual(['42']);
  expect(formatCellValue(true).lines).toEqual(['true']);
});
