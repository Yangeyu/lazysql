import { test, expect } from 'bun:test';
import { exportResult } from '../ExportResult.ts';
import { exportTable } from '../ExportTable.ts';
import { exportTablesCombined } from '../ExportTablesCombined.ts';
import { formatterFor, jsonCombinedFormatter, sqlCombinedFormatter } from '../../../domain/export/RowFormatter.ts';
import { CapabilitySet } from '../../../domain/datasource/capabilities.ts';
import { ok, type Result } from '../../../shared/Result.ts';
import type { DataSource } from '../../../domain/datasource/DataSource.ts';
import type { ColumnMeta, ResultSet, Row } from '../../../domain/datasource/ResultSet.ts';
import type { ObjectRef } from '../../../domain/datasource/schema.ts';
import type { Exporter, ExportSink } from '../../ports/Exporter.ts';
import type { ExportError } from '../../../domain/errors/errors.ts';

const cols: ColumnMeta[] = [{ name: 'id' }, { name: 'label' }];
const ref: ObjectRef = { name: 't', kind: 'table' };

/** An in-memory Exporter that records everything written to it. */
const fakeExporter = () => {
  const state = { buf: '', closed: false, aborted: false, opened: false };
  const exporter: Exporter = {
    open: async (target) => {
      state.opened = true;
      const sink: ExportSink = {
        path: target.path,
        write: async (c: string): Promise<Result<void, ExportError>> => ((state.buf += c), ok(undefined)),
        close: async (): Promise<Result<void, ExportError>> => ((state.closed = true), ok(undefined)),
        abort: async (): Promise<void> => void (state.aborted = true),
      };
      return ok(sink);
    },
  };
  return { exporter, state };
};

/** A Browsable source that pages a fixed dataset; counts its browse calls. */
const tableSource = (rows: Row[]) => {
  const calls = { browse: 0 };
  const source = {
    id: 'fake',
    connect: async () => ok(undefined),
    disconnect: async () => {},
    ping: async () => true,
    capabilities: () => new CapabilitySet([]),
    browse: async (_ref: ObjectRef, spec: { page: { offset: number; limit: number } }): Promise<ResultSet> => {
      calls.browse++;
      return {
        shape: 'tabular',
        columns: cols,
        rows: rows.slice(spec.page.offset, spec.page.offset + spec.page.limit),
        truncated: false,
      };
    },
    count: async () => rows.length,
  } as unknown as DataSource;
  return { source, calls };
};

test('exportResult streams the in-memory result and closes', async () => {
  const { exporter, state } = fakeExporter();
  const result: ResultSet = { shape: 'tabular', columns: cols, rows: [[1, 'a'], [2, 'b']], truncated: false };

  const r = await exportResult(result, formatterFor('csv'), exporter, { path: 'out.csv' });

  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value).toEqual({ rows: 2, path: 'out.csv' });
  expect(state.buf).toBe('id,label\n1,a\n2,b\n');
  expect(state.closed).toBe(true);
});

test('exportTable pages the whole table (short final page ends it)', async () => {
  const { exporter, state } = fakeExporter();
  const { source, calls } = tableSource([[1, 'a'], [2, 'b'], [3, 'c'], [4, 'd'], [5, 'e']]);
  const progress: number[] = [];

  const r = await exportTable(source, ref, formatterFor('csv'), exporter, { path: 't.csv' }, { pageSize: 2 }, undefined, (n) => progress.push(n));

  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value.rows).toBe(5);
  expect(state.buf).toBe('id,label\n1,a\n2,b\n3,c\n4,d\n5,e\n');
  expect(calls.browse).toBe(3); // 2 + 2 + 1(short → stop)
  expect(progress).toEqual([2, 4, 5]); // running count reported per page
  expect(state.closed).toBe(true);
});

test('exportTable rejects a non-browsable source without opening a file', async () => {
  const { exporter, state } = fakeExporter();
  const notBrowsable = {
    id: 'kv',
    connect: async () => ok(undefined),
    disconnect: async () => {},
    ping: async () => true,
    capabilities: () => new CapabilitySet([]),
  } as unknown as DataSource;

  const r = await exportTable(notBrowsable, ref, formatterFor('csv'), exporter, { path: 'x.csv' });

  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.name).toBe('UnsupportedCapabilityError');
  expect(state.opened).toBe(false); // no partial file
});

test('an aborted signal cancels the export and discards the partial file', async () => {
  const { exporter, state } = fakeExporter();
  const { source } = tableSource([[1, 'a'], [2, 'b']]);
  const ctrl = new AbortController();
  ctrl.abort();

  const r = await exportTable(source, ref, formatterFor('csv'), exporter, { path: 't.csv' }, { pageSize: 1 }, ctrl.signal);

  expect(r.ok).toBe(false);
  expect(state.aborted).toBe(true);
  expect(state.closed).toBe(false);
});

/** A Browsable source holding several named tables (browse keys off the ref). */
const multiTableSource = (byName: Record<string, Row[]>): DataSource =>
  ({
    id: 'fake',
    connect: async () => ok(undefined),
    disconnect: async () => {},
    ping: async () => true,
    capabilities: () => new CapabilitySet([]),
    browse: async (r: ObjectRef, spec: { page: { offset: number; limit: number } }): Promise<ResultSet> => {
      const rows = byName[r.name] ?? [];
      return {
        shape: 'tabular',
        columns: cols,
        rows: rows.slice(spec.page.offset, spec.page.offset + spec.page.limit),
        truncated: false,
      };
    },
    count: async () => 0,
  }) as unknown as DataSource;

test('exportTablesCombined writes ONE JSON file keyed by table', async () => {
  const { exporter, state } = fakeExporter();
  const source = multiTableSource({ a: [[1, 'x']], b: [[2, 'y'], [3, 'z']] });
  const progress: number[] = [];

  const r = await exportTablesCombined(
    source,
    [{ name: 'a', kind: 'table' }, { name: 'b', kind: 'table' }],
    jsonCombinedFormatter(),
    exporter,
    { path: 'out.json' },
    undefined,
    (n) => progress.push(n),
  );

  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value).toEqual({ rows: 3, path: 'out.json' });
  expect(JSON.parse(state.buf)).toEqual({
    a: [{ id: 1, label: 'x' }],
    b: [{ id: 2, label: 'y' }, { id: 3, label: 'z' }],
  });
  expect(progress).toEqual([1, 3]); // running total across tables
  expect(state.closed).toBe(true);
});

test('exportTablesCombined concatenates SQL INSERT blocks into ONE file', async () => {
  const { exporter, state } = fakeExporter();
  const source = multiTableSource({ a: [[1, 'x']], b: [[2, 'y']] });

  const r = await exportTablesCombined(
    source,
    [{ name: 'a', kind: 'table' }, { name: 'b', kind: 'table' }],
    sqlCombinedFormatter((ref, _c, rows) => rows.map(() => `INSERT INTO ${ref.name} VALUES (…);`).join('\n')),
    exporter,
    { path: 'out.sql' },
  );

  expect(r.ok).toBe(true);
  expect(state.buf).toBe('-- a\nINSERT INTO a VALUES (…);\n\n-- b\nINSERT INTO b VALUES (…);\n');
  expect(state.closed).toBe(true);
});

test('exportTablesCombined rejects a non-browsable source without opening a file', async () => {
  const { exporter, state } = fakeExporter();
  const notBrowsable = {
    id: 'kv',
    connect: async () => ok(undefined),
    disconnect: async () => {},
    ping: async () => true,
    capabilities: () => new CapabilitySet([]),
  } as unknown as DataSource;

  const r = await exportTablesCombined(notBrowsable, [{ name: 'a', kind: 'table' }], jsonCombinedFormatter(), exporter, { path: 'x.json' });

  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.name).toBe('UnsupportedCapabilityError');
  expect(state.opened).toBe(false);
});
