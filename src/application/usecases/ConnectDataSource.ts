/**
 * Use case: establish a connection to a data source.
 *
 * Pure orchestration — it depends only on the `DataSource` port, never on a
 * concrete adapter. The composition root supplies the instance (DIP).
 */

import type { DataSource } from '../../domain/datasource/DataSource.ts';
import type { Result } from '../../shared/Result.ts';
import type { ConnectionError } from '../../domain/errors/errors.ts';

export const connectDataSource = (
  source: DataSource,
): Promise<Result<void, ConnectionError>> => source.connect();
