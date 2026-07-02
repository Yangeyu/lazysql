/**
 * Use case: export a whole table (or its filtered/sorted view) by paging the
 * Browsable capability — memory stays O(one page), so a million-row table
 * exports without ever holding it all. Source-agnostic: SQL, Mongo, anything
 * Browsable. A non-browsable source is rejected before any file is opened.
 *
 * The column shape is taken from the first page. The true-streaming upgrade
 * (a Streamable cursor for enormous tables) swaps only the chunk producer; the
 * formatter, sink and this signature are unaffected (ADR 0012, DataSource.ts).
 */

import { asBrowsable, type DataSource } from '../../domain/datasource/DataSource.ts';
import type { ObjectRef } from '../../domain/datasource/schema.ts';
import type { Sort, Filter } from '../../domain/query/Query.ts';
import type { RowFormatter } from '../../domain/export/RowFormatter.ts';
import type { Exporter, ExportTarget, ExportSummary } from '../ports/Exporter.ts';
import { ExportError, UnsupportedCapabilityError } from '../../domain/errors/errors.ts';
import { err, type Result } from '../../shared/Result.ts';
import { browsePages } from './browsePages.ts';
import { streamExport } from './streamExport.ts';

const DEFAULT_PAGE = 1000;

export interface ExportTableOptions {
  readonly sort?: Sort | null;
  readonly filter?: Filter | null;
  readonly pageSize?: number;
}

export const exportTable = async (
  source: DataSource,
  ref: ObjectRef,
  formatter: RowFormatter,
  exporter: Exporter,
  target: ExportTarget,
  opts?: ExportTableOptions,
  signal?: AbortSignal,
  onProgress?: (rows: number) => void,
): Promise<Result<ExportSummary, ExportError | UnsupportedCapabilityError>> => {
  const browsable = asBrowsable(source);
  if (!browsable) {
    return err(new UnsupportedCapabilityError(`source "${source.id}" cannot export: not browsable`));
  }

  const { columns, chunks } = await browsePages(
    browsable,
    ref,
    { sort: opts?.sort ?? null, filter: opts?.filter ?? null, pageSize: opts?.pageSize ?? DEFAULT_PAGE },
    signal,
  );

  return streamExport(columns, chunks(), formatter, exporter, target, signal, onProgress);
};
