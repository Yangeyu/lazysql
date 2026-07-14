/**
 * Export feature slice — every export action plus the transient control state
 * it owns (the staged target and the in-flight abort handle), extracted from
 * the store's single closure. The flow semantics live in ADR 0012: stage a
 * y/n confirm with a format choice, stream progress to the status bar, land
 * on a success / cancelled / error notice.
 *
 * The slice reaches the rest of the store only through `ExportSliceCtx` — the
 * live connection, the exporter port, and the tree projections stay owned by
 * the store root and are borrowed, never duplicated.
 */

import type { StoreApi } from 'zustand/vanilla';
import type { AppState, Pending, PendingChoice } from '../store.ts';
import type { DataSource } from '../../../domain/datasource/DataSource.ts';
import { asSqlDumpable } from '../../../domain/datasource/DataSource.ts';
import type { ObjectRef } from '../../../domain/datasource/schema.ts';
import type { ResultSet } from '../../../domain/datasource/ResultSet.ts';
import type { Sort, Filter } from '../../../domain/query/Query.ts';
import type { Exporter, ExportSummary } from '../../../application/ports/Exporter.ts';
import { ok, err, type Result } from '../../../shared/Result.ts';
import { ExportError } from '../../../domain/errors/errors.ts';
import {
  formatterFor,
  sqlFormatter,
  jsonCombinedFormatter,
  sqlCombinedFormatter,
  type RowFormatter,
  type ExportFormat,
} from '../../../domain/export/RowFormatter.ts';
import { exportResult } from '../../../application/usecases/ExportResult.ts';
import { exportTable } from '../../../application/usecases/ExportTable.ts';
import { exportTablesCombined } from '../../../application/usecases/ExportTablesCombined.ts';
import { resolveUserPath } from '../../../shared/path.ts';
import { refKey, type TreeRow } from '../../tree/tree.ts';
import { appError } from '../appError.ts';

export interface ExportSliceCtx {
  readonly set: StoreApi<AppState>['setState'];
  readonly get: StoreApi<AppState>['getState'];
  readonly exporter: Exporter | null;
  /** The live connection — owned by the store root, swapped on attach/disconnect. */
  readonly source: () => DataSource | null;
  /** Tree projections owned by the root (the slice must not rebuild them). */
  readonly rowsNow: () => TreeRow[];
  readonly objectsUnder: (row: TreeRow | undefined) => ObjectRef[];
}

export type ExportActions = Pick<
  AppState,
  | 'exportGrid'
  | 'exportSelectedTable'
  | 'toggleMark'
  | 'clearMarks'
  | 'cycleExportFormat'
  | 'cancelExport'
>;

export interface ExportSlice {
  readonly actions: ExportActions;
  /** Drop the staged export target — cancelPending's export-specific cleanup. */
  readonly dropTarget: () => void;
}

export const createExportSlice = (ctx: ExportSliceCtx): ExportSlice => {
  const { set, get, exporter, source, rowsNow, objectsUnder } = ctx;

  // The in-flight export's abort handle (out of reactive state — a transient
  // control channel); `cancelExport` fires it. (ADR 0012)
  let exportAbort: AbortController | null = null;

  // What the staged export confirm is about — captured when export is invoked,
  // held out of reactive state (only the confirm reads it). Kept so the format
  // can be re-cycled (`f`) against the same target without re-selecting it.
  let exportReq:
    | { readonly kind: 'result'; readonly result: ResultSet }
    | { readonly kind: 'table'; readonly ref: ObjectRef; readonly sort: Sort | null; readonly filter: Filter | null }
    | { readonly kind: 'tables'; readonly refs: readonly ObjectRef[] }
    | null = null;

  /** Default export filename for an object (namespaced tables stay distinct). */
  const exportName = (ref: ObjectRef, ext: string): string =>
    `${ref.namespace ? `${ref.namespace}_` : ''}${ref.name}.${ext}`;

  /** Filename for a combined batch file: the shared namespace when the tables
   *  all live in one schema (e.g. `public.sql`), else a neutral `export.<ext>`. */
  const combinedName = (refs: readonly ObjectRef[], ext: string): string => {
    const namespaces = [...new Set(refs.map((r) => r.namespace).filter((n): n is string => !!n))];
    return `${namespaces.length === 1 ? namespaces[0] : 'export'}.${ext}`;
  };

  /** Run a staged export: enter `exporting` mode (input captured so `esc` can
   *  cancel), stream progress to the status bar, then land on a success / error
   *  / cancelled notice. `run` gets the abort signal + a progress reporter. */
  const runExport = async (
    run: (signal: AbortSignal, onProgress: (rows: number) => void) => Promise<Result<ExportSummary, Error>>,
  ): Promise<void> => {
    exportReq = null; // the confirm's target is consumed once it runs
    const ctrl = new AbortController();
    exportAbort = ctrl;
    set({ mode: 'exporting', notice: 'exporting…', error: null });
    const r = await run(ctrl.signal, (rows) => set({ notice: `exporting… ${rows} rows` }));
    exportAbort = null;
    if (get().mode === 'exporting') set({ mode: 'normal' });
    if (r.ok) set({ notice: `exported ${r.value.rows} rows → ${r.value.path}`, error: null });
    // Neutral wording: a cancelled multi-file batch may have written some
    // complete files already, so don't claim "nothing written".
    else if (ctrl.signal.aborted) set({ notice: 'export cancelled', error: null });
    else set({ error: appError(`export failed: ${r.error.message}`), notice: null });
  };

  /** Formats offered for a target: SQL needs a dialect (INSERTs) and a table to
   *  insert into, so it's table-only; a query result gets CSV/JSON. */
  const formatsFor = (req: NonNullable<typeof exportReq>): ExportFormat[] => {
    const src = source();
    return (req.kind === 'table' || req.kind === 'tables') && src && asSqlDumpable(src)
      ? ['csv', 'json', 'sql']
      : ['csv', 'json'];
  };

  /** CSV batch: one file per table (`<ns>_<name>.csv`) in the working dir —
   *  CSV's columns differ per table so a shared file makes no sense (JSON/SQL
   *  combine into one file via `exportTablesCombined` instead, so this path is
   *  CSV-only). Stops at the first failure (报错停止 policy, ADR 0012). Progress
   *  reports the running row total across tables. */
  const exportCsvFilesPerTable = async (
    src: DataSource,
    refs: readonly ObjectRef[],
    ex: Exporter,
    signal: AbortSignal,
    onProgress: (rows: number) => void,
  ): Promise<Result<ExportSummary, Error>> => {
    let total = 0;
    let done = 0;
    let dir = '';
    for (const ref of refs) {
      // Cancel between tables reports as cancelled (not a partial success) so
      // the notice matches the mid-table and combined paths; files already
      // fully written stay on disk, the in-flight one is discarded.
      if (signal.aborted) return err(new ExportError('export cancelled'));
      const r = await exportTable(
        src, ref, formatterFor('csv'), ex, { path: exportName(ref, 'csv') }, {}, signal,
        (rows) => onProgress(total + rows),
      );
      if (!r.ok) return r;
      total += r.value.rows;
      done += 1;
      const slash = r.value.path.lastIndexOf('/');
      if (slash >= 0) dir = r.value.path.slice(0, slash);
    }
    return ok({ rows: total, path: `${done} files → ${dir}` });
  };

  /** (Re)stage the export confirm from the held target + current format —
   *  unified with every other write (ADR 0012). Shows the resolved destination
   *  and the format; `f` re-cycles the format through here. */
  const stageExportConfirm = (): void => {
    const req = exportReq;
    const ex = exporter;
    if (!req || !ex) return;
    const fmt = get().exportFormat;

    const choice: PendingChoice = {
      label: 'format',
      options: formatsFor(req).map((f) => f.toUpperCase()),
      selected: fmt.toUpperCase(),
    };
    const present = (
      title: string,
      statement: string,
      run: (signal: AbortSignal, onProgress: (rows: number) => void) => Promise<Result<ExportSummary, Error>>,
    ): void =>
      set({
        mode: 'confirm',
        pending: { title, statement, choice, tone: 'normal', run: () => runExport(run) } satisfies Pending,
      });

    if (req.kind === 'result') {
      const view = fmt === 'sql' ? 'csv' : fmt; // SQL isn't offered for a query result
      const path = `query-result.${view}`;
      present('Export the query result', `→ ${resolveUserPath(path)}`, (signal, onProgress) =>
        exportResult(req.result, formatterFor(view), ex, { path }, signal, onProgress),
      );
      return;
    }

    const src = source();
    if (!src) return;

    // One whole-table formatter for `ref` in the chosen format: SQL needs the
    // source's dialect-backed INSERT dump (per row-chunk); CSV/JSON are
    // ref-agnostic. `formatsFor` already gates SQL to a SqlDumpable source, so
    // the fallback below is unreachable — it only satisfies the null guard.
    const makeFormatter = (ref: ObjectRef): RowFormatter => {
      if (fmt === 'sql') {
        const dumpable = asSqlDumpable(src);
        if (!dumpable) return formatterFor('csv');
        return sqlFormatter((cols, rows) => dumpable.insertDump(ref, cols, rows));
      }
      return formatterFor(fmt);
    };

    if (req.kind === 'tables') {
      const { refs } = req;
      // CSV can't share a file (columns differ per table) → one file each.
      // JSON nests tables in an object, SQL concatenates INSERT blocks → one file.
      if (fmt === 'csv') {
        const example = resolveUserPath(exportName(refs[0]!, 'csv'));
        present(
          `Export ${refs.length} tables (CSV, one file each)`,
          `→ ${refs.length} files, e.g. ${example}`,
          (signal, onProgress) => exportCsvFilesPerTable(src, refs, ex, signal, onProgress),
        );
        return;
      }
      const path = combinedName(refs, fmt);
      const dumpable = asSqlDumpable(src);
      const combined =
        fmt === 'sql'
          ? sqlCombinedFormatter((ref, cols, rows) => (dumpable ? dumpable.insertDump(ref, cols, rows) : ''))
          : jsonCombinedFormatter();
      present(
        `Export ${refs.length} tables → one ${fmt.toUpperCase()} file`,
        `→ ${resolveUserPath(path)}`,
        (signal, onProgress) => exportTablesCombined(src, refs, combined, ex, { path }, signal, onProgress),
      );
      return;
    }

    const ref = req.ref;
    present(
      `Export ${ref.name} (whole table)`,
      `→ ${resolveUserPath(exportName(ref, fmt))}`,
      (signal, onProgress) =>
        exportTable(src, ref, makeFormatter(ref), ex, { path: exportName(ref, fmt) }, { sort: req.sort, filter: req.filter }, signal, onProgress),
    );
  };

  /** Point the format at an allowed value for the held target (e.g. drop SQL
   *  when the target became a query result). */
  const clampExportFormat = (): void => {
    if (exportReq && !formatsFor(exportReq).includes(get().exportFormat)) {
      set({ exportFormat: 'csv' });
    }
  };

  const actions: ExportActions = {
    exportGrid: () => {
      if (!exporter) return set({ error: appError('export is unavailable') });
      const { surface, result, current, sort, filter } = get();
      // A query surface has only its in-memory result; a browse surface exports
      // the WHOLE table behind the view (its filter/sort applied), not one page.
      if (surface === 'query') {
        if (!result) return set({ error: appError('nothing to export') });
        exportReq = { kind: 'result', result };
      } else {
        if (!source() || !current) return set({ error: appError('nothing to export') });
        exportReq = { kind: 'table', ref: current, sort, filter };
      }
      clampExportFormat();
      stageExportConfirm();
    },

    exportSelectedTable: () => {
      if (!exporter) return set({ error: appError('export is unavailable') });
      if (!source()) return set({ error: appError('nothing to export') });
      // Marks win over the cursor when present (a selection overrides position);
      // otherwise the cursor's node decides — a schema/category exports all its
      // tables, an object row just itself.
      const marks = get().marks;
      const picked =
        marks.size > 0
          ? get().objects.filter((o) => marks.has(refKey(o)))
          : objectsUnder(rowsNow()[get().treeIndex]);
      const refs = picked.filter((o) => o.kind === 'table' || o.kind === 'view');
      if (refs.length === 0) {
        return set({ error: appError('select a table, a schema, or mark tables (v) to export') });
      }
      exportReq =
        refs.length === 1
          ? { kind: 'table', ref: refs[0]!, sort: null, filter: null }
          : { kind: 'tables', refs };
      clampExportFormat();
      stageExportConfirm();
    },

    toggleMark: () => {
      const row = rowsNow()[get().treeIndex];
      if (row?.type !== 'object') return;
      // Only tables/views hold rows worth exporting; skip index/trigger/… rows.
      if (row.ref.kind !== 'table' && row.ref.kind !== 'view') return;
      const key = refKey(row.ref);
      const next = new Set(get().marks);
      next.has(key) ? next.delete(key) : next.add(key);
      set({ marks: next });
    },

    clearMarks: () => {
      if (get().marks.size > 0) set({ marks: new Set() });
    },

    cycleExportFormat: () => {
      if (!exportReq) return; // a non-export confirm — `f` does nothing
      const allowed = formatsFor(exportReq);
      const next = allowed[(allowed.indexOf(get().exportFormat) + 1) % allowed.length];
      if (next) set({ exportFormat: next });
      stageExportConfirm();
    },

    cancelExport: () => {
      exportAbort?.abort();
      if (get().mode === 'exporting') set({ notice: 'cancelling…' });
    },
  };

  return {
    actions,
    dropTarget: () => {
      exportReq = null;
    },
  };
};
