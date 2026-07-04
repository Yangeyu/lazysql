/**
 * Use case: browse one page of an object's rows.
 *
 * Entirely source-agnostic — it asks the Browsable capability for a window and
 * never constructs a query. Swapping SQLite for Postgres (or Mongo) changes
 * nothing here; that's the payoff of the capability abstraction.
 */

import {
  asBrowsable,
  type DataSource,
} from '../../domain/datasource/DataSource.ts';
import type { ObjectRef } from '../../domain/datasource/schema.ts';
import type { BrowseSpec } from '../../domain/query/Query.ts';
import type { ResultSet } from '../../domain/datasource/ResultSet.ts';
import { ok, err, type Result } from '../../shared/Result.ts';
import {
  UnsupportedCapabilityError,
  DataSourceError,
} from '../../domain/errors/errors.ts';

export interface BrowseResult {
  readonly rows: ResultSet;
  readonly total: number;
  readonly spec: BrowseSpec;
}

const toError = (e: unknown): DataSourceError =>
  e instanceof DataSourceError
    ? e
    : new DataSourceError(e instanceof Error ? e.message : String(e));

export const browseTable = async (
  source: DataSource,
  ref: ObjectRef,
  spec: BrowseSpec,
  signal?: AbortSignal,
): Promise<Result<BrowseResult, DataSourceError>> => {
  const browsable = asBrowsable(source);
  if (!browsable) {
    return err(
      new UnsupportedCapabilityError(`source "${source.id}" cannot browse`),
    );
  }
  try {
    const [rows, total] = await Promise.all([
      browsable.browse(ref, spec, signal),
      browsable.count(ref, spec.filter, signal),
    ]);
    return ok({ rows, total, spec });
  } catch (e) {
    return err(toError(e));
  }
};
