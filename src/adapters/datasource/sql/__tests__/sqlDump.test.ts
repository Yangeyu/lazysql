import { test, expect } from 'bun:test';
import { renderInsertStatements } from '../sqlDump.ts';
import { SqliteDialect } from '../dialects/SqliteDialect.ts';
import type { ColumnMeta, Row } from '../../../../domain/datasource/ResultSet.ts';

const cols: ColumnMeta[] = [{ name: 'id' }, { name: 'label' }];
const ref = { name: 'widget', kind: 'table' as const };

test('emits runnable, quoted, one-per-row INSERTs with escaped literals', () => {
  const out = renderInsertStatements(new SqliteDialect(), ref, cols, [
    [1, 'a'],
    [2, "o'brien"],
  ] as Row[]);
  expect(out).toBe(
    'INSERT INTO "widget" ("id", "label") VALUES (1, \'a\');\n' +
      'INSERT INTO "widget" ("id", "label") VALUES (2, \'o\'\'brien\');',
  );
});

test('renders NULL, boolean and binary as SQL literals', () => {
  const out = renderInsertStatements(new SqliteDialect(), ref, cols, [
    [null, true],
    [3, new Uint8Array([0xde, 0xad])],
  ] as Row[]);
  expect(out).toContain('VALUES (NULL, TRUE)');
  expect(out).toContain("VALUES (3, '\\xdead')");
});
