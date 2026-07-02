/**
 * streamExport — the single export driver shared by every row-source (ADR 0012):
 * open the sink, write the formatter's header, stream each row-chunk, write the
 * footer, close. `chunks` yields Row[] blocks — one block for an in-memory
 * result, many for a paged table — so the two entry points share ONE code path
 * and differ only in what produces the chunks.
 *
 * On any failure (a sink error, an aborted signal, or a producer that throws
 * mid-stream) the partial file is discarded via `sink.abort()`; the boundary
 * returns a Result and never throws. `onProgress` (optional) reports the running
 * row count after each chunk, for a live UI counter.
 */

import type { ColumnMeta, Row } from '../../domain/datasource/ResultSet.ts';
import type { RowFormatter } from '../../domain/export/RowFormatter.ts';
import type { Exporter, ExportTarget, ExportSummary } from '../ports/Exporter.ts';
import { ExportError } from '../../domain/errors/errors.ts';
import { ok, err, type Result } from '../../shared/Result.ts';

export const streamExport = async (
  columns: readonly ColumnMeta[],
  chunks: AsyncIterable<readonly Row[]>,
  formatter: RowFormatter,
  exporter: Exporter,
  target: ExportTarget,
  signal?: AbortSignal,
  onProgress?: (rows: number) => void,
): Promise<Result<ExportSummary, ExportError>> => {
  const opened = await exporter.open(target);
  if (!opened.ok) return opened;
  const sink = opened.value;

  let written = 0;
  try {
    const head = await sink.write(formatter.begin(columns));
    if (!head.ok) return (await sink.abort(), err(head.error));
    for await (const chunk of chunks) {
      if (signal?.aborted) return (await sink.abort(), err(new ExportError('export cancelled')));
      const w = await sink.write(formatter.rows(chunk, columns));
      if (!w.ok) return (await sink.abort(), err(w.error));
      written += chunk.length;
      onProgress?.(written);
    }
    const tail = await sink.write(formatter.end());
    if (!tail.ok) return (await sink.abort(), err(tail.error));
    const closed = await sink.close();
    if (!closed.ok) return err(closed.error);
    return ok({ rows: written, path: sink.path });
  } catch (e) {
    await sink.abort();
    return err(new ExportError(e instanceof Error ? e.message : 'export failed', e));
  }
};
