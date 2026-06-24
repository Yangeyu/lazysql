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
import { UnsupportedCapabilityError } from '../../domain/errors/errors.ts';

export interface BrowseResult {
  readonly rows: ResultSet;
  readonly total: number;
  readonly spec: BrowseSpec;
}

export const browseTable = async (
  source: DataSource,
  ref: ObjectRef,
  spec: BrowseSpec,
  signal?: AbortSignal,
): Promise<Result<BrowseResult, UnsupportedCapabilityError>> => {
  const browsable = asBrowsable(source);
  if (!browsable) {
    return err(
      new UnsupportedCapabilityError(`source "${source.id}" cannot browse`),
    );
  }
  const [rows, total] = await Promise.all([
    browsable.browse(ref, spec, signal),
    browsable.count(ref, signal),
  ]);
  return ok({ rows, total, spec });
};
