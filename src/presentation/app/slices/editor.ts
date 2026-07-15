/**
 * SQL-editor feature slice — the editor text/caret mirror, execution (with the
 * destructive-statement guard), per-connection history, schema-aware completion
 * (catalog build + candidates), and NL→SQL. Extracted from the store's single
 * closure; the store root composes it and borrows `buildCatalog` for the lazy
 * build on first editor focus.
 */

import type { StoreApi } from 'zustand/vanilla';
import type { AppState } from '../store.ts';
import {
  asDdlScriptable,
  asIntrospectable,
  type DataSource,
} from '../../../domain/datasource/DataSource.ts';
import { columnsOf, sectionsFor } from '../../../domain/datasource/schema.ts';
import type { ObjectRef } from '../../../domain/datasource/schema.ts';
import type { ConnectionProfile } from '../../../domain/connection/ConnectionProfile.ts';
import { runQuery } from '../../../application/usecases/RunQuery.ts';
import { generateSql } from '../../../application/usecases/GenerateSql.ts';
import { classifyStatement, dangerKind } from '../../../domain/query/classify.ts';
import type { DangerKind } from '../../../domain/query/classify.ts';
import type {
  SqlGenerator,
  SchemaContext,
} from '../../../application/ports/SqlGenerator.ts';
import type { QueryHistoryStore } from '../../../application/ports/QueryHistoryStore.ts';
import { complete } from '../../completion/sqlCompleter.ts';
import { dialectLabel } from '../../tree/tree.ts';

/** How many recent statements the SQL editor history keeps, per connection. */
export const HISTORY_LIMIT = 100;
/** Tables whose columns are eagerly described for completion. Schema + table
 *  names are unbounded (they need no per-table round-trip); only column lookups
 *  cost a describe each, so they are capped. Beyond this, table/schema completion
 *  still works; per-table column completion is the on-demand future step. */
const CATALOG_DESCRIBE_LIMIT = 200;

/** Presentation wording for a structured danger kind — the dialog headline. */
const dangerHeadline = (kind: DangerKind, sql: string): string => {
  switch (kind) {
    case 'drop':
      return 'DROP — irreversible';
    case 'drop-type':
      return 'DROP TYPE — a shared type; refused while any column still uses it';
    case 'truncate':
      return 'TRUNCATE — irreversible';
    case 'unqualified-write': {
      const verb = sql.match(/^[a-z]+/i)?.[0]?.toUpperCase() ?? 'WRITE';
      return `${verb} with no WHERE — affects ALL rows`;
    }
  }
};

export interface EditorSliceCtx {
  readonly set: StoreApi<AppState>['setState'];
  readonly get: StoreApi<AppState>['getState'];
  /** The live connection (owned by the store root; null when disconnected). */
  readonly source: () => DataSource | null;
  readonly generator: SqlGenerator | null;
  readonly historyStore: QueryHistoryStore | null;
  /** Root-owned: re-list objects after a DDL statement changes the schema. */
  readonly reloadObjects: () => Promise<void>;
  /** Root-owned: the active connection's profile (for the NL dialect). */
  readonly activeProfile: () => ConnectionProfile | null;
}

export type EditorActions = Pick<
  AppState,
  | 'setQuery'
  | 'toggleCompletions'
  | 'executeQuery'
  | 'historyPrev'
  | 'historyNext'
  | 'acceptCompletion'
  | 'beginNl'
  | 'cancelNl'
  | 'generateFromNl'
>;

export interface EditorSlice {
  readonly actions: EditorActions;
  /** Build the completion catalog once per connection (lazy, on editor focus). */
  readonly buildCatalog: () => Promise<void>;
}

export const createEditorSlice = (ctx: EditorSliceCtx): EditorSlice => {
  const { set, get, source, generator, historyStore, reloadObjects, activeProfile } = ctx;

  /** Run the editor's SQL and take over the shared grid with the result. The
   *  execution proper, shared by the direct run and the guarded (confirmed)
   *  path so the two can't drift. */
  const runEditorSql = async (text: string): Promise<void> => {
    const active = source();
    if (!active) return;
    const { history } = get();
    set({ loading: true, queryError: null, notice: null });
    const r = await runQuery(active, text);
    if (!r.ok) {
      set({ loading: false, queryError: r.error.message, queryElapsedMs: null });
      // A DROP refused because dependents exist can be retried with CASCADE —
      // a heavier hammer, so it gets its own confirm rather than auto-running.
      // Name the objects CASCADE would also drop so the choice is informed.
      const cascade = asDdlScriptable(active)?.cascadeRetry(text, r.error) ?? null;
      if (cascade) {
        set({
          mode: 'confirm',
          focus: 'grid',
          pending: {
            // A type's dependents are columns in live tables, not standalone
            // objects — CASCADE alters those tables, so say so plainly.
            title: /^\s*drop\s+type\b/i.test(text)
              ? 'Columns still use this type — CASCADE will DROP them from their tables'
              : 'Other objects depend on it — drop them too?',
            statement: cascade.sql,
            details: cascade.dependents,
            tone: 'danger',
            run: () => runEditorSql(cascade.sql),
          },
        });
      }
      return;
    }
    // Record in history, skipping an immediate duplicate and keeping only the
    // most recent HISTORY_LIMIT entries.
    const nextHistory = (
      history[history.length - 1] === text ? history : [...history, text]
    ).slice(-HISTORY_LIMIT);
    // The result takes over the shared grid as a read-only 'query' surface.
    // The browsed table is dropped (current=null) so its row ops can't fire
    // on a query result; re-selecting it in the sidebar returns to browse.
    set({
      loading: false,
      surface: 'query',
      current: null,
      pkColumns: [],
      // The editor echoes the executed statement: clear the draft so the
      // placeholder shows `text`, the SQL that produced this result.
      statement: text,
      queryText: '',
      result: r.value.result,
      total: r.value.result.rows.length,
      queryElapsedMs: r.value.elapsedMs,
      queryError: null,
      gridRow: 0,
      gridCol: 0,
      mainTab: 'data',
      structure: null,
      focus: 'grid',
      history: nextHistory,
      historyIndex: null,
    });
    const id = get().activeId;
    if (id && historyStore) void historyStore.save(id, nextHistory);
    // A DDL statement (CREATE/DROP/ALTER/TRUNCATE/…) changed the schema, so the
    // tree and completion catalog are now stale — reload them in the background
    // (fire-and-forget) so the result shows immediately and the tree catches up.
    if (classifyStatement(text) === 'ddl') void reloadObjects();
  };

  /** Recompute completions for the editor text at `caret`. Keywords complete
   *  even before the catalog loads (it may still be null); schema/table/column
   *  candidates join in once it is built — so typing a DROP/SELECT is never dead
   *  while introspecting. */
  const completionsFor = (text: string, caret: number): string[] =>
    complete(text, get().catalog, caret).candidates;

  /** Build the schema/table/column catalog once, for schema-aware completion.
   *  Schema + table names come straight from the single introspection (every
   *  object, no per-table round-trip); only columns need a describe each, so
   *  those are bounded — table/schema completion stays complete even for a huge
   *  DB while column completion covers the first `CATALOG_DESCRIBE_LIMIT`. */
  const buildCatalog = async (): Promise<void> => {
    const active = source();
    if (!active) return;
    const introspectable = asIntrospectable(active);
    if (!introspectable) return;
    try {
      const snapshot = await introspectable.introspect();
      // Completion only wants column-bearing objects (tables/views), not the
      // index/trigger/… kinds that have no columns.
      const relations = snapshot.objects.filter((o) =>
        sectionsFor(o.kind).includes('columns'),
      );
      const qualify = (o: ObjectRef): string =>
        o.namespace ? `${o.namespace}.${o.name}` : o.name;

      const schemas = [
        ...new Set(
          relations.map((o) => o.namespace).filter((s): s is string => !!s),
        ),
      ];
      const tables = [...new Set(relations.map((o) => o.name))];
      const tablesBySchema: Record<string, string[]> = {};
      for (const o of relations) {
        if (o.namespace) (tablesBySchema[o.namespace] ??= []).push(o.name);
      }

      const columnsByTable: Record<string, string[]> = {};
      await Promise.all(
        relations.slice(0, CATALOG_DESCRIBE_LIMIT).map(async (o) => {
          try {
            const schema = await introspectable.describe(o);
            const cols = columnsOf(schema).map((c) => c.name);
            columnsByTable[qualify(o)] = cols; // de-collided key
            columnsByTable[o.name] ??= cols; // bare fallback (first schema wins)
          } catch {
            /* skip a table we cannot describe */
          }
        }),
      );
      set({ catalog: { schemas, tables, tablesBySchema, columnsByTable } });
    } catch {
      /* completion simply stays empty if introspection fails */
    }
  };

  const actions: EditorActions = {
    setQuery: (value, caret) => {
      const c = caret ?? value.length;
      // A real edit changes the text; only then reset the history cursor (you're
      // back on a fresh draft). A SAME-text write is the <textarea> echoing a
      // programmatic setText (history/NL/clear) back through onContentChange —
      // keep historyIndex so ↓ (historyNext) can still step forward. Completions
      // track the caret; suppressed while the toggle is off.
      const changed = value !== get().queryText;
      set({
        queryText: value,
        editorCaret: c,
        ...(changed ? { historyIndex: null } : {}),
        completions: get().completionsOn ? completionsFor(value, c) : [],
      });
    },

    toggleCompletions: () => {
      const on = !get().completionsOn;
      const { queryText, editorCaret } = get();
      set({
        completionsOn: on,
        completions: on ? completionsFor(queryText, editorCaret) : [],
      });
    },

    executeQuery: async () => {
      if (!source()) return;
      const text = get().queryText.trim();
      if (!text) return;
      // A destructive statement (unqualified UPDATE/DELETE, or DROP/TRUNCATE)
      // stages a confirm rather than running straight off the editor's ⏎. Focus
      // leaves the editor so its native input can't swallow the y/n the prompt
      // is waiting on.
      const kind = dangerKind(text);
      if (kind) {
        set({
          mode: 'confirm',
          focus: 'grid',
          pending: {
            title: dangerHeadline(kind, text),
            statement: text,
            tone: 'danger',
            run: () => runEditorSql(text),
          },
        });
        return;
      }
      await runEditorSql(text);
    },

    historyPrev: () => {
      const { history, historyIndex } = get();
      if (history.length === 0) return;
      const idx =
        historyIndex === null
          ? history.length - 1
          : Math.max(0, historyIndex - 1);
      const text = history[idx] ?? '';
      set({ historyIndex: idx, queryText: text, editorCaret: text.length, completions: [] });
    },

    historyNext: () => {
      const { history, historyIndex } = get();
      if (historyIndex === null) return;
      if (historyIndex >= history.length - 1) {
        set({ historyIndex: null, queryText: '', editorCaret: 0, completions: [] });
        return;
      }
      const idx = historyIndex + 1;
      const text = history[idx] ?? '';
      set({ historyIndex: idx, queryText: text, editorCaret: text.length, completions: [] });
    },

    acceptCompletion: () => {
      const { queryText, editorCaret, completions } = get();
      const top = completions[0];
      if (!top) return;
      // Replace the partial identifier ending AT the caret, leaving the rest of
      // the (possibly multi-line) text untouched; seat the caret after the word.
      const head = queryText.slice(0, editorCaret);
      const tail = queryText.slice(editorCaret);
      const word = head.match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? '';
      const newHead = head.slice(0, head.length - word.length) + top;
      const next = newHead + tail;
      set({
        queryText: next,
        editorCaret: newHead.length,
        completions: completionsFor(next, newHead.length),
      });
    },

    beginNl: () => {
      if (!generator) {
        set({ queryError: 'set ANTHROPIC_API_KEY to enable AI (NL→SQL)' });
        return;
      }
      set({ nlMode: true, queryError: null });
    },

    cancelNl: () => set({ nlMode: false }),

    generateFromNl: async (prompt) => {
      const { catalog } = get();
      const nl = prompt.trim();
      if (!generator || !nl) {
        set({ nlMode: false });
        return;
      }
      set({ nlMode: false, generating: true, queryError: null });
      const schema: SchemaContext = {
        tables: catalog
          ? catalog.tables.map((t) => ({
              name: t,
              columns: catalog.columnsByTable[t] ?? [],
            }))
          : [],
      };
      const profile = activeProfile();
      const dialect = profile ? dialectLabel(profile.driver) : 'SQL';
      const r = await generateSql(generator, { nl, schema, dialect });
      if (!r.ok) {
        set({ generating: false, queryError: r.error.message });
        return;
      }
      // Fill the editor for review — NEVER auto-execute (§5.2). Reviewing needs
      // the full pane, so expand it even if the user collapsed it mid-generation.
      set({
        generating: false,
        queryText: r.value.sql,
        editorCaret: r.value.sql.length,
        nlExplanation: r.value.explanation,
        nlKind: r.value.kind,
        completions: [],
        focus: 'editor',
        editorExpanded: true,
      });
    },
  };

  return { actions, buildCatalog };
};
