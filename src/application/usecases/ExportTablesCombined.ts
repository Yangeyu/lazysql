/**
 * Use case: export SEVERAL whole tables into ONE file — a JSON object keyed by
 * table, or a concatenated SQL dump (a whole-schema / marked-set batch). CSV
 * can't combine (columns differ per table), so it uses the one-file-per-table
 * path instead. Memory stays O(one page): each table is paged via the shared
 * `browsePages`, streamed into the single open sink, table by table.
 *
 * On any failure — a sink error, an aborted signal, or a producer that throws —
 * the partial file is discarded via `sink.abort()`; the boundary returns a Result
 * and never throws. `onProgress` reports the running row total across all tables.
 */

import { asBrowsable, type DataSource } from '../../domain/datasource/DataSource.ts';
import type { ObjectRef } from '../../domain/datasource/schema.ts';
import type { CombinedFormatter } from '../../domain/export/RowFormatter.ts';
import type { Exporter, ExportTarget, ExportSummary } from '../ports/Exporter.ts';
import { ExportError, UnsupportedCapabilityError } from '../../domain/errors/errors.ts';
import { ok, err, type Result } from '../../shared/Result.ts';
import { browsePages } from './browsePages.ts';

const DEFAULT_PAGE = 1000;

export const exportTablesCombined = async (
  source: DataSource,
  refs: readonly ObjectRef[],
  formatter: CombinedFormatter,
  exporter: Exporter,
  target: ExportTarget,
  signal?: AbortSignal,
  onProgress?: (rows: number) => void,
): Promise<Result<ExportSummary, ExportError | UnsupportedCapabilityError>> => {
  const browsable = asBrowsable(source);
  if (!browsable) {
    return err(new UnsupportedCapabilityError(`source "${source.id}" cannot export: not browsable`));
  }

  const opened = await exporter.open(target);
  if (!opened.ok) return opened;
  const sink = opened.value;

  let written = 0;
  try {
    const head = await sink.write(formatter.fileBegin());
    if (!head.ok) return (await sink.abort(), err(head.error));

    let first = true;
    for (const ref of refs) {
      if (signal?.aborted) return (await sink.abort(), err(new ExportError('export cancelled')));
      const { columns, chunks } = await browsePages(
        browsable, ref, { sort: null, filter: null, pageSize: DEFAULT_PAGE }, signal,
      );
      const open = await sink.write(formatter.tableBegin(ref, columns, first));
      if (!open.ok) return (await sink.abort(), err(open.error));
      first = false;
      for await (const chunk of chunks()) {
        if (signal?.aborted) return (await sink.abort(), err(new ExportError('export cancelled')));
        const w = await sink.write(formatter.rows(chunk, columns));
        if (!w.ok) return (await sink.abort(), err(w.error));
        written += chunk.length;
        onProgress?.(written);
      }
      const close = await sink.write(formatter.tableEnd());
      if (!close.ok) return (await sink.abort(), err(close.error));
    }

    const tail = await sink.write(formatter.fileEnd());
    if (!tail.ok) return (await sink.abort(), err(tail.error));
    const closed = await sink.close();
    if (!closed.ok) return err(closed.error);
    return ok({ rows: written, path: sink.path });
  } catch (e) {
    await sink.abort();
    return err(new ExportError(e instanceof Error ? e.message : 'export failed', e));
  }
};
