/**
 * The shared SQL adapter contract — ONE set of assertions every SQL engine must
 * pass (docs/ARCHITECTURE.md §10, adr/0002). Engine test files own probe, seed
 * and teardown, then call `runSqlContract`; engine-specific behaviours (PG
 * cascade drop / uuid columns, MySQL jsonCanonical, SQLite master
 * introspection) stay in those files. This is deliberately NOT a .test.ts —
 * it only registers tests when an engine invokes it, so the three suites can
 * no longer drift apart the way hand-copied assertions did.
 *
 * Seed contract every engine's beforeAll must provide:
 *   - table `widget` (id int PRIMARY KEY, label text NULLABLE, qty int)
 *     seeded with ('w1',1) … ('w25',25)
 *   - view `pricey` AS SELECT id, label FROM widget WHERE qty > 10
 * Read-only assertions run first; the tail tests mutate widget (an update on
 * id 1 and 3, one insert+delete) — engine extras should not depend on labels.
 */

import { test, expect } from 'bun:test';
import type { DataSource } from '../../../../domain/datasource/DataSource.ts';
import {
  asIntrospectable,
  asQueryable,
  asRowEditable,
} from '../../../../domain/datasource/DataSource.ts';
import type { ObjectRef } from '../../../../domain/datasource/schema.ts';
import { columnsOf } from '../../../../domain/datasource/schema.ts';
import { Capability } from '../../../../domain/datasource/capabilities.ts';
import { listObjects } from '../../../../application/usecases/ListObjects.ts';
import { browseTable } from '../../../../application/usecases/BrowseTable.ts';
import { unwrap } from '../../../../shared/Result.ts';
import { firstPage, sql } from '../../../../domain/query/Query.ts';

export interface SqlContractEngine {
  /** Probe result — false skips every contract test (server unreachable). */
  readonly available: boolean;
  /** The connected source; a thunk because engines connect in beforeAll. */
  readonly source: () => DataSource;
  /** The seeded widget table, namespaced the way this engine lists it. */
  readonly widget: ObjectRef;
  /** Placeholder renderer for raw verification queries (`?` or `$n`). */
  readonly ph: (index: number) => string;
}

export const runSqlContract = (e: SqlContractEngine): void => {
  const t = test.skipIf(!e.available);
  const src = (): DataSource => e.source();
  const view: ObjectRef = e.widget.namespace
    ? { namespace: e.widget.namespace, name: 'pricey', kind: 'view' }
    : { name: 'pricey', kind: 'view' };

  const valueAt = async (id: number, column: string): Promise<unknown> => {
    const rs = await asQueryable(src())!.execute(
      sql(`SELECT ${column} FROM widget WHERE id = ${e.ph(1)}`, [id]),
    );
    return rs.rows[0]?.[0] ?? null;
  };

  // ── capabilities & catalog ────────────────────────────────────────────────

  t('declares Query/SchemaIntrospect/Browse/RowEdit/Transaction', () => {
    const caps = src().capabilities();
    expect(caps.has(Capability.Query)).toBe(true);
    expect(caps.has(Capability.SchemaIntrospect)).toBe(true);
    expect(caps.has(Capability.Browse)).toBe(true);
    expect(caps.has(Capability.RowEdit)).toBe(true);
    expect(caps.has(Capability.Transaction)).toBe(true);
  });

  t('listObjects finds the widget table under its namespace', async () => {
    const objects = unwrap(await listObjects(src()));
    const found = objects.find((o) => o.name === 'widget');
    expect(found?.kind).toBe('table');
    expect(found?.namespace).toBe(e.widget.namespace);
  });

  t('describe gives a view both its columns and its defining source', async () => {
    const schema = await asIntrospectable(src())!.describe(view);
    expect(schema.detail.map((d) => d.kind)).toEqual(['columns', 'source']);
    expect(columnsOf(schema).map((c) => c.name)).toEqual(['id', 'label']);
    const s = schema.detail.find((d) => d.kind === 'source');
    expect(s?.kind === 'source' && s.text).toMatch(/select/i);
  });

  t('describe reports the primary key and nullability', async () => {
    const cols = columnsOf(await asIntrospectable(src())!.describe(e.widget));
    const id = cols.find((c) => c.name === 'id');
    const label = cols.find((c) => c.name === 'label');
    expect(id?.isPrimaryKey).toBe(true);
    expect(id?.nullable).toBe(false);
    expect(label?.isPrimaryKey).toBe(false);
    expect(label?.nullable).toBe(true);
  });

  // ── browsing (read-only) ──────────────────────────────────────────────────

  t('browse paginates and counts', async () => {
    const result = unwrap(await browseTable(src(), e.widget, { page: firstPage(10) }));
    expect(result.total).toBe(25);
    expect(result.rows.rows.length).toBe(10);
    expect(result.rows.truncated).toBe(true);
    expect(result.rows.shape).toBe('tabular');
    expect(result.rows.columns.map((c) => c.name)).toEqual(['id', 'label', 'qty']);
  });

  t('second page returns the remainder window', async () => {
    const result = unwrap(
      await browseTable(src(), e.widget, { page: { offset: 20, limit: 10 } }),
    );
    expect(result.rows.rows.length).toBe(5);
    expect(result.rows.truncated).toBe(false);
  });

  t('descending sort orders by the column', async () => {
    const result = unwrap(
      await browseTable(src(), e.widget, {
        page: firstPage(5),
        sort: { column: 'qty', direction: 'desc' },
      }),
    );
    expect(Number(result.rows.rows[0]?.[2])).toBe(25);
    expect(Number(result.rows.rows[4]?.[2])).toBe(21);
  });

  t('numeric gt filter narrows rows and the count matches', async () => {
    const result = unwrap(
      await browseTable(src(), e.widget, {
        page: firstPage(50),
        filter: { conditions: [{ column: 'qty', op: 'gt', value: '20' }] },
      }),
    );
    expect(result.total).toBe(5); // qty 21..25
    expect(result.rows.rows.length).toBe(5);
  });

  t('contains filter binds the value and matches substrings', async () => {
    const result = unwrap(
      await browseTable(src(), e.widget, {
        page: firstPage(50),
        filter: { conditions: [{ column: 'label', op: 'contains', value: '25' }] },
      }),
    );
    expect(result.total).toBe(1);
    expect(result.rows.rows[0]?.[1]).toBe('w25');
  });

  t('contains filter works on a non-text column', async () => {
    // The uuid/int class of failure: substring match must coerce the column,
    // never assume text (PG: `integer ~~* unknown` without the cast).
    const result = unwrap(
      await browseTable(src(), e.widget, {
        page: firstPage(50),
        filter: { conditions: [{ column: 'qty', op: 'contains', value: '25' }] },
      }),
    );
    expect(result.total).toBe(1);
    expect(result.rows.rows[0]?.[1]).toBe('w25');
  });

  // ── editing (mutating tail — keep read assertions above this line) ───────

  t('stableKey keeps an unsorted browse in key order across an update', async () => {
    // Without the tiebreaker heap/natural order can move an updated row — the
    // grid row would jump after every save.
    await asRowEditable(src())!.update(
      e.widget,
      [{ column: 'id', value: 3 }],
      [{ column: 'label', value: 'w3-touched' }],
    );
    const result = unwrap(
      await browseTable(src(), e.widget, { page: firstPage(10), stableKey: ['id'] }),
    );
    expect(result.rows.rows.map((r) => Number(r[0]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  t('update writes exactly one row by key', async () => {
    const r = await asRowEditable(src())!.update(
      e.widget,
      [{ column: 'id', value: 1 }],
      [{ column: 'label', value: 'updated-1' }],
    );
    expect(r.affected).toBe(1);
    expect(await valueAt(1, 'label')).toBe('updated-1');
  });

  t('update with a non-matching key rolls back (0 rows)', async () => {
    await expect(
      asRowEditable(src())!.update(
        e.widget,
        [{ column: 'id', value: 99999 }],
        [{ column: 'label', value: 'nope' }],
      ),
    ).rejects.toThrow(/affected 0/);
  });

  t('insert then delete round-trips a row', async () => {
    const editable = asRowEditable(src())!;
    const ins = await editable.insert(e.widget, [
      { column: 'label', value: 'temp' },
      { column: 'qty', value: 999 },
    ]);
    expect(ins.affected).toBe(1);

    const created = await asQueryable(src())!.execute(
      sql(`SELECT id FROM widget WHERE qty = ${e.ph(1)}`, [999]),
    );
    const id = Number(created.rows[0]?.[0]);
    expect(id).toBeGreaterThan(0);

    const del = await editable.delete(e.widget, [{ column: 'id', value: id }]);
    expect(del.affected).toBe(1);
    expect(await valueAt(id, 'label')).toBeNull();
  });
};
