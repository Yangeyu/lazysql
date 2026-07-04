/**
 * Store-level tests for NL→SQL and capability gating. The store reaches its
 * connection only through a fake ConnectionService (no DB, no API key): the
 * service opens a fake DataSource and the store connects to it on init().
 */

import { test, expect } from 'bun:test';
import { createAppStore } from '../store.ts';
import { Capability, CapabilitySet } from '../../../domain/datasource/capabilities.ts';
import { ok } from '../../../shared/Result.ts';
import { QueryError } from '../../../domain/errors/errors.ts';
import { PostgresDialect } from '../../../adapters/datasource/sql/dialects/PostgresDialect.ts';
import type {
  DataSource,
  DdlScriptable,
  Queryable,
} from '../../../domain/datasource/DataSource.ts';
import type { ResultSet } from '../../../domain/datasource/ResultSet.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';
import type { ConnectionProfile } from '../../../domain/connection/ConnectionProfile.ts';
import type { ObjectKind } from '../../../domain/datasource/schema.ts';
import type { SqlGenerator } from '../../../application/ports/SqlGenerator.ts';
import type { Exporter } from '../../../application/ports/Exporter.ts';
import { SIDEBAR_STEP, SIDEBAR_MIN, SIDEBAR_MAX } from '../layout.ts';

const fakeSource: DataSource = {
  id: 'fake',
  connect: async () => ok(undefined),
  disconnect: async () => {},
  ping: async () => true,
  capabilities: () => new CapabilitySet([]),
};

const serviceFor = (profile: ConnectionProfile): ConnectionService => ({
  list: async () => [profile],
  open: async () => ok(fakeSource),
  save: async () => {},
  remove: async () => {},
});

test('generateFromNl fills the editor and classifies, never executing', async () => {
  const generator: SqlGenerator = {
    generate: async () => ({
      sql: 'UPDATE users SET active = 0 WHERE id = 5',
      explanation: 'deactivates user 5',
    }),
  };
  // The dialect ('SQLite') is now derived from the active profile's driver.
  const profile: ConnectionProfile = {
    id: 'x',
    name: 'X',
    driver: 'sqlite',
    options: {},
  };
  const store = createAppStore({
    connectionService: serviceFor(profile),
    generator,
    initial: profile,
  });
  await store.getState().init();

  await store.getState().generateFromNl('deactivate user 5');

  const s = store.getState();
  expect(s.queryText).toBe('UPDATE users SET active = 0 WHERE id = 5');
  expect(s.nlExplanation).toBe('deactivates user 5');
  expect(s.nlKind).toBe('write'); // flagged destructive
  expect(s.nlMode).toBe(false);
  expect(s.result).toBeNull(); // generation does NOT run the query (no result)
  expect(s.surface).toBe('browse'); // …and never flips the grid to a query surface
});

test('NL is unavailable (and beginNl is a no-op) without a generator', () => {
  const profile: ConnectionProfile = {
    id: 'x',
    name: 'X',
    driver: 'sqlite',
    options: {},
  };
  const store = createAppStore({ connectionService: serviceFor(profile) });
  expect(store.getState().nlAvailable).toBe(false);

  store.getState().beginNl();
  expect(store.getState().nlMode).toBe(false);
  expect(store.getState().queryError).toContain('ANTHROPIC_API_KEY');
});

test('exportGrid stages a y/n confirm; confirming writes and reports a notice', async () => {
  const state = { buf: '', closed: false };
  const exporter: Exporter = {
    open: async (target) => {
      const sink = {
        path: target.path,
        write: async (c: string) => ((state.buf += c), ok(undefined)),
        close: async () => ((state.closed = true), ok(undefined)),
        abort: async () => {},
      };
      return ok(sink);
    },
  };
  const profile: ConnectionProfile = { id: 'x', name: 'X', driver: 'sqlite', options: {} };
  const store = createAppStore({ connectionService: serviceFor(profile), exporter });
  store.setState({
    surface: 'query',
    result: { shape: 'tabular', columns: [{ name: 'id' }, { name: 'label' }], rows: [[1, 'a'], [2, 'b']], truncated: false },
  });

  // X stages the confirm — nothing is written yet (the dialog owns the screen).
  store.getState().exportGrid();
  expect(store.getState().mode).toBe('confirm');
  expect(store.getState().pending?.statement).toContain('query-result.csv');
  expect(state.buf).toBe('');

  // y runs it: the file is written and the result surfaces as a notice.
  await store.getState().confirmPending();
  expect(state.buf).toBe('id,label\n1,a\n2,b\n');
  expect(state.closed).toBe(true);
  expect(store.getState().mode).toBe('normal');
  expect(store.getState().notice).toContain('exported 2 rows');
});

test('esc cancels an in-flight export: sink aborted, not finalized, cancelled notice', async () => {
  let aborted = false;
  let closed = false;
  const exporter: Exporter = {
    open: async (t) =>
      ok({
        path: t.path,
        write: async () => ok(undefined),
        close: async () => ((closed = true), ok(undefined)),
        abort: async () => void (aborted = true),
      }),
  };
  // A Browsable source whose first page stays pending until we release the gate,
  // so the export is deterministically "in flight" when we cancel it.
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const source = {
    id: 'g',
    connect: async () => ok(undefined),
    disconnect: async () => {},
    ping: async () => true,
    capabilities: () => new CapabilitySet([]),
    browse: async () => {
      await gate;
      return { shape: 'tabular', columns: [{ name: 'id' }], rows: [[1]], truncated: false };
    },
    count: async () => 1,
  } as unknown as DataSource;
  const profile: ConnectionProfile = { id: 'x', name: 'X', driver: 'sqlite', options: {} };
  const service: ConnectionService = {
    list: async () => [profile],
    open: async () => ok(source),
    save: async () => {},
    remove: async () => {},
  };
  const store = createAppStore({ connectionService: service, initial: profile, exporter });
  await store.getState().init();
  store.setState({ surface: 'browse', current: { name: 't', kind: 'table' } });

  store.getState().exportGrid();
  expect(store.getState().mode).toBe('confirm');
  const done = store.getState().confirmPending(); // starts the export; browse is gated
  await Promise.resolve();
  expect(store.getState().mode).toBe('exporting');

  store.getState().cancelExport();
  release(); // let the in-flight page resolve so the loop notices the abort
  await done;

  expect(aborted).toBe(true);
  expect(closed).toBe(false); // never finalized
  expect(store.getState().mode).toBe('normal');
  expect(store.getState().notice).toContain('cancelled');
});

test('the export confirm cycles CSV → JSON → SQL for a dialect-backed table', async () => {
  const noop: Exporter = {
    open: async (t) => ok({ path: t.path, write: async () => ok(undefined), close: async () => ok(undefined), abort: async () => {} }),
  };
  const source = {
    id: 's',
    connect: async () => ok(undefined),
    disconnect: async () => {},
    ping: async () => true,
    capabilities: () => new CapabilitySet([]),
    browse: async () => ({ shape: 'tabular', columns: [{ name: 'id' }], rows: [], truncated: false }),
    count: async () => 0,
    insertDump: () => 'INSERT INTO "widget" ...;', // makes it SqlDumpable
  } as unknown as DataSource;
  const profile: ConnectionProfile = { id: 'x', name: 'X', driver: 'sqlite', options: {} };
  const service: ConnectionService = { list: async () => [profile], open: async () => ok(source), save: async () => {}, remove: async () => {} };
  const store = createAppStore({ connectionService: service, initial: profile, exporter: noop });
  await store.getState().init();
  store.setState({ surface: 'browse', current: { name: 'widget', kind: 'table' } });

  store.getState().exportGrid();
  expect(store.getState().exportFormat).toBe('csv');
  expect(store.getState().pending?.statement).toContain('widget.csv');
  // The dialog gets the whole option set + current selection (segmented radio).
  expect(store.getState().pending?.choice).toEqual({
    label: 'format',
    options: ['CSV', 'JSON', 'SQL'],
    selected: 'CSV',
  });

  store.getState().cycleExportFormat();
  expect(store.getState().exportFormat).toBe('json');
  expect(store.getState().pending?.statement).toContain('widget.json');
  expect(store.getState().pending?.choice?.selected).toBe('JSON');

  store.getState().cycleExportFormat();
  expect(store.getState().exportFormat).toBe('sql');
  expect(store.getState().pending?.statement).toContain('widget.sql');

  store.getState().cycleExportFormat(); // wraps back
  expect(store.getState().exportFormat).toBe('csv');
});

test('cancelling the export confirm writes nothing', () => {
  let opened = false;
  const exporter: Exporter = { open: async (t) => ((opened = true), ok({ path: t.path, write: async () => ok(undefined), close: async () => ok(undefined), abort: async () => {} })) };
  const profile: ConnectionProfile = { id: 'x', name: 'X', driver: 'sqlite', options: {} };
  const store = createAppStore({ connectionService: serviceFor(profile), exporter });
  store.setState({ surface: 'query', result: { shape: 'tabular', columns: [{ name: 'id' }], rows: [[1]], truncated: false } });

  store.getState().exportGrid();
  store.getState().cancelPending();

  expect(store.getState().mode).toBe('normal');
  expect(store.getState().pending).toBeNull();
  expect(opened).toBe(false); // never touched the sink
});

const noopExporter: Exporter = {
  open: async (t) =>
    ok({ path: t.path, write: async () => ok(undefined), close: async () => ok(undefined), abort: async () => {} }),
};

/** A Browsable source; `sqlDump` adds the SqlDumpable capability (SQL format). */
const browsableSource = (opts?: { sqlDump?: boolean }): DataSource =>
  ({
    id: 's',
    connect: async () => ok(undefined),
    disconnect: async () => {},
    ping: async () => true,
    capabilities: () => new CapabilitySet([]),
    browse: async () => ({ shape: 'tabular', columns: [{ name: 'id' }], rows: [], truncated: false }),
    count: async () => 0,
    ...(opts?.sqlDump ? { insertDump: () => 'INSERT INTO "t" (...) VALUES (...);' } : {}),
  }) as unknown as DataSource;

/** Connect the store to `source` (so `active` is set) and seat two tables `a`,`b`
 *  under an expanded Tables category. Returns the connected store. */
const storeWithTables = async (source: DataSource, exporter: Exporter) => {
  const profile: ConnectionProfile = { id: 'x', name: 'X', driver: 'sqlite', options: {} };
  const service: ConnectionService = { list: async () => [profile], open: async () => ok(source), save: async () => {}, remove: async () => {} };
  const store = createAppStore({ connectionService: service, initial: profile, exporter });
  await store.getState().init();
  store.setState({
    objects: [{ name: 'a', kind: 'table' }, { name: 'b', kind: 'table' }],
    rootExpanded: true,
    expandedCats: new Set<ObjectKind>(['table']),
  });
  return store;
};

test('v marks tables (toggle) and X stages a batch export of the marked set', async () => {
  const store = await storeWithTables(browsableSource({ sqlDump: true }), noopExporter);
  const rows = store.getState().treeRows();
  const iA = rows.findIndex((r) => r.type === 'object' && r.ref.name === 'a');
  const iB = rows.findIndex((r) => r.type === 'object' && r.ref.name === 'b');

  store.setState({ treeIndex: iA });
  store.getState().toggleMark();
  store.setState({ treeIndex: iB });
  store.getState().toggleMark();
  expect(store.getState().marks.size).toBe(2);

  // Toggling a marked row clears just that one (re-mark restores it).
  store.getState().toggleMark();
  expect(store.getState().marks.size).toBe(1);
  store.getState().toggleMark();
  expect(store.getState().marks.size).toBe(2);

  store.getState().exportSelectedTable();
  const p = store.getState().pending;
  expect(store.getState().mode).toBe('confirm');
  expect(p?.title).toContain('2 tables');
  expect(p?.statement).toContain('2 files'); // one file per table
  expect(p?.choice?.options).toEqual(['CSV', 'JSON', 'SQL']); // SqlDumpable → SQL offered
});

test('X on a schema/category node exports all its tables; on one table, a single file', async () => {
  const store = await storeWithTables(browsableSource(), noopExporter); // not SqlDumpable
  const rows = store.getState().treeRows();
  const iCat = rows.findIndex((r) => r.type === 'category');
  const iA = rows.findIndex((r) => r.type === 'object' && r.ref.name === 'a');

  // The "Tables" category → every table under it (batch, no marks).
  store.setState({ treeIndex: iCat, marks: new Set() });
  store.getState().exportSelectedTable();
  expect(store.getState().pending?.title).toContain('2 tables');

  // A single table row → a single-file confirm; SQL absent (source can't dump it).
  store.getState().cancelPending();
  store.setState({ treeIndex: iA, marks: new Set() });
  store.getState().exportSelectedTable();
  expect(store.getState().pending?.title).toContain('a (whole table)');
  expect(store.getState().pending?.statement).toContain('a.csv');
  expect(store.getState().pending?.choice?.options).toEqual(['CSV', 'JSON']);
});

test('batch export: CSV stays multi-file; JSON and SQL each combine into one file', async () => {
  const store = await storeWithTables(browsableSource({ sqlDump: true }), noopExporter);
  const iCat = store.getState().treeRows().findIndex((r) => r.type === 'category');
  store.setState({ treeIndex: iCat, marks: new Set(), exportFormat: 'csv' });

  store.getState().exportSelectedTable();
  expect(store.getState().pending?.title).toContain('CSV, one file each');
  expect(store.getState().pending?.statement).toContain('2 files');

  store.getState().cycleExportFormat(); // → JSON: one combined file
  expect(store.getState().exportFormat).toBe('json');
  expect(store.getState().pending?.title).toContain('one JSON file');
  expect(store.getState().pending?.statement).not.toContain('files');
  expect(store.getState().pending?.statement).toContain('export.json'); // sqlite ⇒ neutral base name

  store.getState().cycleExportFormat(); // → SQL: one combined file
  expect(store.getState().exportFormat).toBe('sql');
  expect(store.getState().pending?.title).toContain('one SQL file');
  expect(store.getState().pending?.statement).toContain('export.sql');
});

test('toggleMark is a no-op off a table/view row (e.g. the category header)', async () => {
  const store = await storeWithTables(browsableSource(), noopExporter);
  const iCat = store.getState().treeRows().findIndex((r) => r.type === 'category');
  store.setState({ treeIndex: iCat });
  store.getState().toggleMark();
  expect(store.getState().marks.size).toBe(0);
});

test('clearMarks drops every mark at once', async () => {
  const store = await storeWithTables(browsableSource(), noopExporter);
  store.setState({ marks: new Set(['table  a', 'table  b']) });
  store.getState().clearMarks();
  expect(store.getState().marks.size).toBe(0);
});

test('widen/narrow adjust the sidebar width by a step, clamped to bounds', () => {
  const profile: ConnectionProfile = { id: 'x', name: 'X', driver: 'sqlite', options: {} };
  const store = createAppStore({ connectionService: serviceFor(profile) });
  const w0 = store.getState().sidebarWidth;

  store.getState().widenSidebar();
  expect(store.getState().sidebarWidth).toBe(w0 + SIDEBAR_STEP);
  store.getState().narrowSidebar();
  expect(store.getState().sidebarWidth).toBe(w0);

  for (let i = 0; i < 30; i++) store.getState().narrowSidebar();
  expect(store.getState().sidebarWidth).toBe(SIDEBAR_MIN); // floored, never below
  for (let i = 0; i < 60; i++) store.getState().widenSidebar();
  expect(store.getState().sidebarWidth).toBe(SIDEBAR_MAX); // capped, never above
});

test('esc in a cell edit discards the draft and falls back to the value view', () => {
  const profile: ConnectionProfile = { id: 'x', name: 'X', driver: 'sqlite', options: {} };
  const store = createAppStore({ connectionService: serviceFor(profile) });
  // Editing is a sub-state of inspecting a cell (single entry: view → `e`), so
  // cancel returns to view — the inspector stays open, it doesn't close to null.
  store.setState({
    cellView: {
      column: 'label',
      value: 'w1',
      offset: 0,
      mode: 'edit',
      seedText: 'w1',
      jsonCanonical: false,
      rowKey: [{ column: 'id', value: 1 }],
    },
  });
  store.getState().cancelEdit();
  expect(store.getState().cellView?.mode).toBe('view');
});

// ── cell edit + JSON: jsonCanonical seeding, no-op saves, draft validation ──

/** A browse of `docs(id pk, payload jsonb)` with the cursor on the payload cell.
 *  `jsonCanonical` comes from the cached describe (`structure`), as in the app. */
const editFixture = (payloadCanonical: boolean) => {
  const profile: ConnectionProfile = { id: 'x', name: 'X', driver: 'sqlite', options: {} };
  const store = createAppStore({ connectionService: serviceFor(profile) });
  store.setState({
    current: { name: 'docs', kind: 'table' },
    result: {
      shape: 'tabular',
      columns: [{ name: 'id' }, { name: 'payload' }],
      rows: [[1, '{"n":12345678901234567890,"a":[1,2]}']],
      truncated: false,
    },
    pkColumns: ['id'],
    gridRow: 0,
    gridCol: 1,
    structure: {
      ref: { name: 'docs', kind: 'table' },
      detail: [
        {
          kind: 'columns',
          columns: [
            { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
            {
              name: 'payload',
              dataType: payloadCanonical ? 'jsonb' : 'text',
              nullable: true,
              isPrimaryKey: false,
              ...(payloadCanonical ? { jsonCanonical: true as const } : {}),
            },
          ],
        },
      ],
    },
  });
  return store;
};

test('beginEdit pretty-seeds a jsonCanonical column with its tokens verbatim', () => {
  const store = editFixture(true);
  store.getState().beginEdit();
  const cv = store.getState().cellView;
  if (cv?.mode !== 'edit') throw new Error('expected edit mode');
  expect(cv.jsonCanonical).toBe(true);
  expect(cv.seedText.split('\n').length).toBeGreaterThan(1); // pretty, not raw
  expect(cv.seedText).toContain('12345678901234567890'); // no parse→stringify
});

test('beginEdit seeds a plain column with the raw value untouched', () => {
  const store = editFixture(false);
  store.getState().beginEdit();
  const cv = store.getState().cellView;
  if (cv?.mode !== 'edit') throw new Error('expected edit mode');
  expect(cv.jsonCanonical).toBe(false);
  expect(cv.seedText).toBe('{"n":12345678901234567890,"a":[1,2]}');
});

test('submitEdit with an untouched draft stages nothing and pops back to view', () => {
  const store = editFixture(true);
  store.getState().beginEdit();
  const cv = store.getState().cellView;
  if (cv?.mode !== 'edit') throw new Error('expected edit mode');
  store.getState().submitEdit(cv.seedText);
  expect(store.getState().mode).toBe('normal'); // no confirm staged
  expect(store.getState().cellView?.mode).toBe('view');
  expect(store.getState().notice).toBe('no change');
});

test('submitEdit rejects malformed JSON on a jsonCanonical column, keeping the draft', () => {
  const store = editFixture(true);
  store.getState().beginEdit();
  store.getState().submitEdit('{oops');
  expect(store.getState().mode).toBe('normal'); // no confirm staged
  expect(store.getState().cellView?.mode).toBe('edit'); // still editing
  expect(store.getState().error).toContain('JSON');
});

test('submitEdit stages a changed, valid draft as an update confirm', () => {
  const store = editFixture(true);
  store.getState().beginEdit();
  store.getState().submitEdit('{"a": 2}');
  expect(store.getState().mode).toBe('confirm');
  // The fake source can't render a dialect preview → the readable fallback.
  expect(store.getState().pending?.statement).toContain('update docs set payload');
});

test('submitEdit targets the cell the edit was seeded from, not the live cursor', () => {
  // The grid under the overlay stays mouse-reachable, so the cursor can move
  // mid-edit; the staged UPDATE must still hit the original column and row.
  const store = editFixture(true);
  store.getState().beginEdit();
  store.setState({ gridCol: 0, gridRow: 99 }); // simulate a click elsewhere
  store.getState().submitEdit('{"a": 2}');
  expect(store.getState().pending?.statement).toContain('set payload');
  expect(store.getState().pending?.statement).toContain('where id=1');
});

test('leaving the edit clears a stale validation error', () => {
  const store = editFixture(true);
  store.getState().beginEdit();
  store.getState().submitEdit('{oops'); // sets the validation error
  store.getState().cancelEdit(); // esc back to view
  expect(store.getState().error).toBeNull();
});

test('a plain column keeps save-always semantics — an untouched draft still stages', () => {
  // Deliberate re-saves (e.g. to fire ON UPDATE triggers) must keep working on
  // non-canonical columns; the no-op skip exists only where the seed's layout
  // is the editor's own reformatting.
  const store = editFixture(false);
  store.getState().beginEdit();
  const cv = store.getState().cellView;
  if (cv?.mode !== 'edit') throw new Error('expected edit mode');
  store.getState().submitEdit(cv.seedText);
  expect(store.getState().mode).toBe('confirm');
});

test('a dependents-blocked DROP escalates to a CASCADE confirm, then runs it', async () => {
  // A Postgres-shaped fake: the plain DROP raises SQLSTATE 2BP01; the CASCADE
  // retry succeeds. cascadeRetry reuses the real dialect so the wiring is exercised
  // end-to-end (executeQuery's danger guard → confirm → failure → CASCADE confirm).
  const dialect = new PostgresDialect();
  const executed: string[] = [];
  const okResult: ResultSet = {
    shape: 'tabular',
    columns: [],
    rows: [],
    affected: 0,
    truncated: false,
  };
  const source: DataSource & Queryable & DdlScriptable = {
    id: 'pg-fake',
    connect: async () => ok(undefined),
    disconnect: async () => {},
    ping: async () => true,
    capabilities: () => new CapabilitySet([Capability.Query, Capability.DdlScript]),
    execute: async (query) => {
      executed.push(query.text);
      if (/\bdrop\b/i.test(query.text) && !/\bcascade\b/i.test(query.text)) {
        throw new QueryError('cannot drop table widget because other objects depend on it', {
          code: '2BP01',
          detail: 'view order_summary depends on table widget',
        });
      }
      return okResult;
    },
    dropStatement: (ref) => dialect.dropQuery(ref).text,
    cascadeRetry: (sql, error) => dialect.cascadeDrop(sql, error),
  };
  const profile: ConnectionProfile = { id: 'pg', name: 'PG', driver: 'postgres', options: {} };
  const store = createAppStore({
    connectionService: {
      list: async () => [profile],
      open: async () => ok(source),
      save: async () => {},
      remove: async () => {},
    },
    initial: profile,
  });
  await store.getState().init();

  store.getState().setQuery('DROP TABLE "public"."widget";');
  await store.getState().executeQuery(); // DROP is destructive → first confirm
  expect(store.getState().mode).toBe('confirm');
  expect(store.getState().pending?.title).toContain('irreversible');
  expect(store.getState().pending?.tone).toBe('danger');

  await store.getState().confirmPending(); // runs the DROP → 2BP01 → CASCADE confirm
  expect(store.getState().mode).toBe('confirm');
  expect(store.getState().pending?.statement).toContain('CASCADE'); // exact SQL echoed
  expect(store.getState().pending?.details).toContain('view order_summary'); // names the casualty

  await store.getState().confirmPending(); // runs the CASCADE retry → succeeds
  expect(executed.some((s) => /CASCADE/i.test(s))).toBe(true);
  expect(store.getState().mode).toBe('normal');
  expect(store.getState().pending).toBeNull();
});

test('a non-Queryable source gates off the SQL editor and NL→SQL', async () => {
  // fakeSource has no execute() → not Queryable (like Mongo/Redis).
  const generator: SqlGenerator = {
    generate: async () => ({ sql: 'SELECT 1', explanation: '' }),
  };
  const profile: ConnectionProfile = {
    id: 'kv',
    name: 'KV',
    driver: 'redis',
    options: {},
  };
  const store = createAppStore({
    connectionService: serviceFor(profile),
    generator,
    initial: profile,
  });
  await store.getState().init();

  expect(store.getState().queryable).toBe(false);
  // NL→SQL needs the Query capability to run, so it's hidden even with a generator.
  expect(store.getState().nlAvailable).toBe(false);

  // Pressing `:` (focusPane 'editor') is inert — the editor pane never activates
  // for a non-SQL source.
  store.getState().focusPane('editor');
  expect(store.getState().focus).not.toBe('editor');
  expect(store.getState().error).toContain('does not support SQL');
});

// ── remove connection ──

/** A service whose remove/list share one mutable list, so a removal is observable
 *  in the next list() the way the real YAML repo behaves. */
const mutableService = (initial: ConnectionProfile[]): ConnectionService => {
  let profiles = [...initial];
  return {
    list: async () => [...profiles],
    open: async () => ok(fakeSource),
    save: async () => {},
    remove: async (id) => {
      profiles = profiles.filter((p) => p.id !== id);
    },
  };
};

test('beginRemoveConnection stages a danger confirm naming the cursor connection', async () => {
  const a: ConnectionProfile = { id: 'a', name: 'Local PG', driver: 'postgres', options: {} };
  const b: ConnectionProfile = { id: 'b', name: 'Staging', driver: 'mysql', options: {} };
  const store = createAppStore({ connectionService: mutableService([a, b]) });
  await store.getState().init(); // no `initial` → two inactive connection roots, cursor at 0

  store.getState().beginRemoveConnection();

  expect(store.getState().mode).toBe('confirm');
  expect(store.getState().pending?.title).toContain('Local PG');
  expect(store.getState().pending?.tone).toBe('danger');
});

test('confirming the remove deletes only that profile and leaves confirm mode', async () => {
  const a: ConnectionProfile = { id: 'a', name: 'Local PG', driver: 'postgres', options: {} };
  const b: ConnectionProfile = { id: 'b', name: 'Staging', driver: 'mysql', options: {} };
  const store = createAppStore({ connectionService: mutableService([a, b]) });
  await store.getState().init();

  store.getState().beginRemoveConnection(); // cursor on 'a'
  await store.getState().confirmPending();

  const s = store.getState();
  expect(s.profiles.map((p) => p.id)).toEqual(['b']);
  expect(s.mode).toBe('normal');
  expect(s.pending).toBeNull();
});

test('beginRemoveConnection is a no-op when the cursor is not on a connection row', async () => {
  const a: ConnectionProfile = { id: 'a', name: 'Local PG', driver: 'postgres', options: {} };
  const store = createAppStore({ connectionService: mutableService([a]) });
  await store.getState().init();
  store.setState({ treeIndex: 999 }); // past the last row → no connection under the cursor

  store.getState().beginRemoveConnection();

  expect(store.getState().mode).toBe('normal');
  expect(store.getState().pending).toBeNull();
});

// ── save connection: editing the active profile must rebuild its live source ──

/** A service that records the options each open() received and applies save()
 *  to a mutable list, so a post-save reconnect is observable. */
const editableService = (initial: ConnectionProfile) => {
  let profiles = [initial];
  const opened: unknown[] = [];
  const service: ConnectionService = {
    list: async () => [...profiles],
    open: async (p) => {
      opened.push(p.options.database);
      return ok(fakeSource);
    },
    save: async (p) => {
      profiles = profiles.map((x) => (x.id === p.id ? p : x));
    },
    remove: async () => {},
  };
  return { service, opened };
};

test('saving an edit to the ACTIVE connection reconnects with the new options', async () => {
  const a: ConnectionProfile = { id: 'a', name: 'M', driver: 'mongodb', options: { database: 'oops(' } };
  const { service, opened } = editableService(a);
  const store = createAppStore({ connectionService: service, initial: a });
  await store.getState().init();
  expect(opened).toEqual(['oops(']);

  await store.getState().saveConnection({ ...a, options: { database: 'fixed' } }, null);

  // The live source was rebuilt from the edited profile — not left stale.
  expect(opened).toEqual(['oops(', 'fixed']);
  expect(store.getState().activeId).toBe('a');
});

test('saving an edit to an INACTIVE connection leaves the live one untouched', async () => {
  const a: ConnectionProfile = { id: 'a', name: 'M', driver: 'mongodb', options: { database: 'live' } };
  const b: ConnectionProfile = { id: 'b', name: 'N', driver: 'mongodb', options: { database: 'other' } };
  const { service, opened } = editableService(a);
  const store = createAppStore({ connectionService: service, initial: a });
  await store.getState().init();

  await store.getState().saveConnection(b, null);

  expect(opened).toEqual(['live']); // no reconnect
  expect(store.getState().activeId).toBe('a');
});

// ── editor: completion toggle + caret-aware accept (ADR 0010) ──

const editorStore = () =>
  createAppStore({
    connectionService: serviceFor({ id: 'e', name: 'E', driver: 'sqlite', options: {} }),
  });

test('toggleCompletions flips the flag and clears candidates (gates Tab/accept)', () => {
  const store = editorStore();
  store.setState({ completions: ['name'], completionsOn: true });

  store.getState().toggleCompletions();
  expect(store.getState().completionsOn).toBe(false);
  expect(store.getState().completions).toEqual([]);

  store.getState().toggleCompletions();
  expect(store.getState().completionsOn).toBe(true);
});

test('acceptCompletion replaces the partial word AT the caret, keeping the tail', () => {
  const store = editorStore();
  // Caret sits right after "na", mid-statement — the tail " FROM t" must survive
  // (the old whole-text version would have replaced the trailing "t" instead).
  store.setState({ queryText: 'SELECT na FROM t', editorCaret: 9, completions: ['name'], completionsOn: true });

  store.getState().acceptCompletion();

  expect(store.getState().queryText).toBe('SELECT name FROM t');
  expect(store.getState().editorCaret).toBe(11); // just past the inserted word
});

test('a stale slow browse cannot overwrite a newer navigation (nav epoch)', async () => {
  let releaseSlow = (): void => {};
  const slowGate = new Promise<void>((r) => (releaseSlow = r));
  const browsable = {
    ...fakeSource,
    browse: async (_ref: unknown, spec: { filter?: { conditions: Array<{ value: string }> } }): Promise<ResultSet> => {
      const v = spec.filter?.conditions[0]?.value ?? '';
      if (v === 'slow') await slowGate;
      return { shape: 'tabular', columns: [{ name: 'label' }], rows: [[v.toUpperCase()]], truncated: false };
    },
    count: async () => 1,
  } as unknown as DataSource;
  const profile: ConnectionProfile = { id: 'x', name: 'X', driver: 'sqlite', options: {} };
  const store = createAppStore({
    connectionService: { ...serviceFor(profile), open: async () => ok(browsable) },
  });
  await store.getState().connectProfile(profile);
  store.setState({
    current: { name: 't', kind: 'table' },
    focus: 'grid',
    result: { shape: 'tabular', columns: [{ name: 'label' }], rows: [['x']], truncated: false },
  });

  const slow = store.getState().commitFilter('slow');
  const fast = store.getState().commitFilter('fast');
  await fast;
  releaseSlow(); // the abandoned navigation resolves AFTER the newer one
  await slow;

  const s = store.getState();
  expect(s.result?.rows).toEqual([['FAST']]);
  expect(s.filter?.conditions[0]?.value).toBe('fast');
  expect(s.error).toBeNull();
  expect(s.loading).toBe(false);
});
