/**
 * Use case: export an in-memory ResultSet — the current grid view (a query
 * result, or a browse page). WYSIWYG "export what's shown": the rows are already
 * loaded, so there's no source round-trip. For a whole table use `exportTable`.
 */

import type { ResultSet, Row } from '../../domain/datasource/ResultSet.ts';
import type { RowFormatter } from '../../domain/export/RowFormatter.ts';
import type { Exporter, ExportTarget, ExportSummary } from '../ports/Exporter.ts';
import type { ExportError } from '../../domain/errors/errors.ts';
import type { Result } from '../../shared/Result.ts';
import { streamExport } from './streamExport.ts';

export const exportResult = (
  result: ResultSet,
  formatter: RowFormatter,
  exporter: Exporter,
  target: ExportTarget,
  signal?: AbortSignal,
  onProgress?: (rows: number) => void,
): Promise<Result<ExportSummary, ExportError>> => {
  async function* one(): AsyncIterable<readonly Row[]> {
    yield result.rows;
  }
  return streamExport(result.columns, one(), formatter, exporter, target, signal, onProgress);
};
