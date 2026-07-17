/**
 * browsePages — page a Browsable table into row-chunks for streaming export.
 * Memory stays O(one page): the first page is fetched eagerly so the caller
 * learns the column shape before opening a sink, and `chunks()` re-yields it then
 * walks the rest until a short (or empty) page ends the table. Stops early on an
 * aborted signal. Shared by the single-table (`exportTable`) and combined
 * multi-table (`exportTablesCombined`) drivers so the paging logic lives once.
 *
 * Pages are ordered by the table's primary key (as a tiebreaker after any user
 * sort) whenever the source can introspect one: offset paging without a
 * deterministic order can repeat or skip rows when the table is written to
 * mid-export. The same describe also carries each column's declared-JSON
 * marker into `columns` (`ColumnMeta.jsonKind`), so the JSON formatter can
 * nest those cells. Both are best effort — a source without introspection (or
 * a failing describe) loses ordering and JSON nesting, never the export.
 */

import {
  asIntrospectable,
  type Browsable,
  type DataSource,
} from '../../domain/datasource/DataSource.ts';
import type { ObjectRef, JsonKind } from '../../domain/datasource/schema.ts';
import { columnsOf } from '../../domain/datasource/schema.ts';
import type { ColumnMeta, Row } from '../../domain/datasource/ResultSet.ts';
import type { Sort, Filter } from '../../domain/query/Query.ts';

export interface TablePages {
  /** Column shape, learned from the first page (before any sink is opened). */
  readonly columns: readonly ColumnMeta[];
  /** The row-chunks, first page first, then each subsequent page. */
  chunks(): AsyncIterable<readonly Row[]>;
}

interface SchemaFacts {
  readonly stableKey?: readonly string[];
  readonly jsonKinds?: ReadonlyMap<string, JsonKind>;
}

const schemaFactsOf = async (source: DataSource, ref: ObjectRef): Promise<SchemaFacts> => {
  const introspectable = asIntrospectable(source);
  if (!introspectable) return {};
  try {
    const columns = columnsOf(await introspectable.describe(ref));
    const pk = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    const jsonKinds = new Map(
      columns.flatMap((c) => (c.jsonKind ? [[c.name, c.jsonKind] as const] : [])),
    );
    return {
      stableKey: pk.length > 0 ? pk : undefined,
      jsonKinds: jsonKinds.size > 0 ? jsonKinds : undefined,
    };
  } catch {
    return {}; // introspection is an enrichment, never a gate
  }
};

export const browsePages = async (
  table: DataSource & Browsable,
  ref: ObjectRef,
  opts: { sort: Sort | null; filter: Filter | null; pageSize: number },
  signal?: AbortSignal,
): Promise<TablePages> => {
  const { sort, filter, pageSize: limit } = opts;
  const { stableKey, jsonKinds } = await schemaFactsOf(table, ref);
  const first = await table.browse(
    ref,
    { page: { offset: 0, limit }, sort, filter, stableKey },
    signal,
  );
  async function* chunks(): AsyncIterable<readonly Row[]> {
    let current = first;
    let offset = 0;
    for (;;) {
      yield current.rows;
      if (current.rows.length < limit) return; // a short page is the last page
      offset += limit;
      if (signal?.aborted) return;
      current = await table.browse(
        ref,
        { page: { offset, limit }, sort, filter, stableKey },
        signal,
      );
    }
  }
  const columns = jsonKinds
    ? first.columns.map((c) => {
        const jsonKind = jsonKinds.get(c.name);
        return jsonKind ? { ...c, jsonKind } : c;
      })
    : first.columns;
  return { columns, chunks };
};
