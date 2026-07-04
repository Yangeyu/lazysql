/**
 * Use case: run a free-form query the user typed in the editor. Uses the
 * Queryable capability and times the round-trip, returning a typed Result so the
 * UI can show either the result set or a friendly error.
 */

import {
  asQueryable,
  type DataSource,
} from '../../domain/datasource/DataSource.ts';
import type { ResultSet } from '../../domain/datasource/ResultSet.ts';
import { sql } from '../../domain/query/Query.ts';
import { ok, err, type Result } from '../../shared/Result.ts';
import {
  UnsupportedCapabilityError,
  toDataSourceError,
  type DataSourceError,
} from '../../domain/errors/errors.ts';

export interface QueryRun {
  readonly result: ResultSet;
  readonly elapsedMs: number;
}

export const runQuery = async (
  source: DataSource,
  text: string,
): Promise<Result<QueryRun, DataSourceError>> => {
  const queryable = asQueryable(source);
  if (!queryable) {
    return err(new UnsupportedCapabilityError('source cannot run queries'));
  }
  const started = performance.now();
  try {
    const result = await queryable.execute(sql(text));
    return ok({ result, elapsedMs: Math.round(performance.now() - started) });
  } catch (e) {
    return err(toDataSourceError(e));
  }
};
