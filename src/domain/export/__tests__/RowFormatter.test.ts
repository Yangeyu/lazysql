import { test, expect } from 'bun:test';
import { formatterFor, sqlFormatter, jsonCombinedFormatter, sqlCombinedFormatter } from '../RowFormatter.ts';
import type { ColumnMeta, Row } from '../../datasource/ResultSet.ts';
import type { ObjectRef } from '../../datasource/schema.ts';

const cols: ColumnMeta[] = [{ name: 'id' }, { name: 'label' }];

const render = (fmt: ReturnType<typeof formatterFor>, columns: ColumnMeta[], rows: Row[]): string =>
  fmt.begin(columns) + fmt.rows(rows, columns) + fmt.end();

test('CSV: header, rows, and RFC-4180 quoting of comma/quote/newline', () => {
  const out = render(formatterFor('csv'), cols, [
    [1, 'plain'],
    [2, 'a,b'],
    [3, 'she said "hi"'],
    [4, 'two\nlines'],
  ]);
  expect(out).toBe(
    'id,label\n' +
      '1,plain\n' +
      '2,"a,b"\n' +
      '3,"she said ""hi"""\n' +
      '4,"two\nlines"\n',
  );
});

test('CSV: null is an empty field, bigint/binary are stringified', () => {
  const out = render(formatterFor('csv'), cols, [[null, 10n], [5, new Uint8Array([0x00, 0xff, 0x0a])]]);
  expect(out).toBe('id,label\n,10\n5,00ff0a\n');
});

test('JSON: a parseable array of row objects, binary→hex, bigint→string', () => {
  const out = render(formatterFor('json'), cols, [
    [1, 'a'],
    [2, new Uint8Array([0xde, 0xad])],
    [3, 9007199254740993n],
  ]);
  expect(JSON.parse(out)).toEqual([
    { id: 1, label: 'a' },
    { id: 2, label: 'dead' },
    { id: 3, label: '9007199254740993' },
  ]);
});

test('empty result still yields a valid document', () => {
  expect(render(formatterFor('csv'), cols, [])).toBe('id,label\n');
  expect(JSON.parse(render(formatterFor('json'), cols, []))).toEqual([]);
});

test('sqlFormatter delegates each chunk to the injected dump, no header/footer', () => {
  const calls: number[] = [];
  const fmt = sqlFormatter((_cols, rows) => {
    calls.push(rows.length);
    return `-- ${rows.length} rows`;
  });
  expect(fmt.begin(cols)).toBe('');
  expect(fmt.rows([[1, 'a']], cols)).toBe('-- 1 rows\n');
  expect(fmt.rows([], cols)).toBe(''); // empty chunk emits nothing
  expect(fmt.end()).toBe('');
  expect(calls).toEqual([1]); // not called for the empty chunk
});

test('streaming across multiple chunks keeps CSV/JSON well-formed', () => {
  // Two rows() calls (as the paged table export does) must not double the header
  // or drop the JSON comma between chunks.
  const csv = formatterFor('csv');
  const csvOut = csv.begin(cols) + csv.rows([[1, 'a']], cols) + csv.rows([[2, 'b']], cols) + csv.end();
  expect(csvOut).toBe('id,label\n1,a\n2,b\n');

  const json = formatterFor('json');
  const jsonOut = json.begin(cols) + json.rows([[1, 'a']], cols) + json.rows([[2, 'b']], cols) + json.end();
  expect(JSON.parse(jsonOut)).toEqual([{ id: 1, label: 'a' }, { id: 2, label: 'b' }]);
});

const users: ObjectRef = { name: 'users', kind: 'table', namespace: 'public' };
const orders: ObjectRef = { name: 'orders', kind: 'table', namespace: 'public' };

test('jsonCombinedFormatter: one parseable object keyed by qualified table name', () => {
  const fmt = jsonCombinedFormatter();
  // Two rows() calls for `users` (as a paged export does) must keep the comma.
  const out =
    fmt.fileBegin() +
    fmt.tableBegin(users, cols, true) +
    fmt.rows([[1, 'a']], cols) +
    fmt.rows([[2, 'b']], cols) +
    fmt.tableEnd() +
    fmt.tableBegin(orders, cols, false) +
    fmt.rows([[9, 'z']], cols) +
    fmt.tableEnd() +
    fmt.fileEnd();
  expect(JSON.parse(out)).toEqual({
    'public.users': [{ id: 1, label: 'a' }, { id: 2, label: 'b' }],
    'public.orders': [{ id: 9, label: 'z' }],
  });
});

test('jsonCombinedFormatter: an empty table is a valid empty array', () => {
  const fmt = jsonCombinedFormatter();
  const t: ObjectRef = { name: 't', kind: 'table' };
  const out =
    fmt.fileBegin() + fmt.tableBegin(t, cols, true) + fmt.rows([], cols) + fmt.tableEnd() + fmt.fileEnd();
  expect(JSON.parse(out)).toEqual({ t: [] });
});

test('sqlCombinedFormatter concatenates per-table INSERT blocks under a name comment', () => {
  const fmt = sqlCombinedFormatter((ref, _c, rows) => `INSERT INTO ${ref.name} -- ${rows.length}`);
  const a: ObjectRef = { name: 'a', kind: 'table' };
  const b: ObjectRef = { name: 'b', kind: 'table' };
  const out =
    fmt.fileBegin() +
    fmt.tableBegin(a, cols, true) +
    fmt.rows([[1, 'x']], cols) +
    fmt.tableEnd() +
    fmt.tableBegin(b, cols, false) +
    fmt.rows([[2, 'y']], cols) +
    fmt.tableEnd() +
    fmt.fileEnd();
  expect(out).toBe('-- a\nINSERT INTO a -- 1\n\n-- b\nINSERT INTO b -- 1\n');
});
