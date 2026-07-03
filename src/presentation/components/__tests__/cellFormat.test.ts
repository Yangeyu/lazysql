import { test, expect } from 'bun:test';
import { formatCellValue, prettyJson } from '../cellFormat.ts';

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

// ── prettyJson: whitespace-only layout, tokens verbatim ──

test('prettyJson lays out nested JSON structurally, empty containers compact', () => {
  expect(prettyJson('{"a":1,"b":{"c":[1,2],"d":{}}}')).toBe(
    '{\n  "a": 1,\n  "b": {\n    "c": [\n      1,\n      2\n    ],\n    "d": {}\n  }\n}',
  );
});

test('prettyJson copies tokens verbatim — big numbers and escapes survive', () => {
  // JSON.parse→stringify would truncate the digits and resolve the escape;
  // the lexer-level layout must not.
  const pretty = prettyJson('{"n":12345678901234567890,"s":"\\u00e9 a{b:c,d}"}');
  expect(pretty).toContain('12345678901234567890');
  expect(pretty).toContain('"\\u00e9 a{b:c,d}"');
});

test('prettyJson is idempotent', () => {
  const once = prettyJson('[{"a":1},{"b":2}]');
  expect(once).not.toBeNull();
  expect(prettyJson(once ?? '')).toBe(once);
});

test('prettyJson returns null for non-JSON and bare scalars', () => {
  expect(prettyJson('{not json')).toBeNull();
  expect(prettyJson('hello')).toBeNull();
  expect(prettyJson('123')).toBeNull();
});

test('the json view keeps big numbers verbatim too', () => {
  const { type, lines } = formatCellValue('{"n":12345678901234567890}');
  expect(type).toBe('json');
  expect(lines.join('')).toContain('12345678901234567890');
});
