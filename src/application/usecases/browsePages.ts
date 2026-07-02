/**
 * browsePages — page a Browsable table into row-chunks for streaming export.
 * Memory stays O(one page): the first page is fetched eagerly so the caller
 * learns the column shape before opening a sink, and `chunks()` re-yields it then
 * walks the rest until a short (or empty) page ends the table. Stops early on an
 * aborted signal. Shared by the single-table (`exportTable`) and combined
 * multi-table (`exportTablesCombined`) drivers so the paging logic lives once.
 */

import type { Browsable } from '../../domain/datasource/DataSource.ts';
import type { ObjectRef } from '../../domain/datasource/schema.ts';
import type { ColumnMeta, Row } from '../../domain/datasource/ResultSet.ts';
import type { Sort, Filter } from '../../domain/query/Query.ts';

export interface TablePages {
  /** Column shape, learned from the first page (before any sink is opened). */
  readonly columns: readonly ColumnMeta[];
  /** The row-chunks, first page first, then each subsequent page. */
  chunks(): AsyncIterable<readonly Row[]>;
}

export const browsePages = async (
  table: Browsable,
  ref: ObjectRef,
  opts: { sort: Sort | null; filter: Filter | null; pageSize: number },
  signal?: AbortSignal,
): Promise<TablePages> => {
  const { sort, filter, pageSize: limit } = opts;
  const first = await table.browse(ref, { page: { offset: 0, limit }, sort, filter }, signal);
  async function* chunks(): AsyncIterable<readonly Row[]> {
    let current = first;
    let offset = 0;
    for (;;) {
      yield current.rows;
      if (current.rows.length < limit) return; // a short page is the last page
      offset += limit;
      if (signal?.aborted) return;
      current = await table.browse(ref, { page: { offset, limit }, sort, filter }, signal);
    }
  }
  return { columns: first.columns, chunks };
};
