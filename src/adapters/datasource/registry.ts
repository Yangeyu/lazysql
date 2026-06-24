/**
 * DataSourceFactory — maps a ConnectionProfile to a concrete DataSource. This
 * is the single OCP extension point: supporting Postgres/MySQL/Mongo/Redis adds
 * a branch here (plus its adapter), and nothing in domain/application changes.
 */

import type { ConnectionProfile } from '../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../domain/datasource/DataSource.ts';
import { ConnectionError } from '../../domain/errors/errors.ts';
import { ok, err, type Result } from '../../shared/Result.ts';
import { SqlDataSource } from './sql/SqlDataSource.ts';
import { SqliteDialect } from './sql/dialects/SqliteDialect.ts';
import { BunSqliteDriver } from './sql/drivers/BunSqliteDriver.ts';

export const createDataSource = (
  profile: ConnectionProfile,
): Result<DataSource, ConnectionError> => {
  switch (profile.driver) {
    case 'sqlite': {
      const file = String(profile.options.file ?? '');
      if (!file) {
        return err(new ConnectionError('sqlite profile requires options.file'));
      }
      return ok(
        new SqlDataSource(
          profile.id,
          new BunSqliteDriver(file),
          new SqliteDialect(),
        ),
      );
    }
    // Phase 1+: case 'postgres' / 'mysql' → new SqlDataSource(id, PgDriver, PgDialect)
    // Phase 6:  case 'mongodb' / 'redis'  → MongoDataSource / RedisDataSource
    default:
      return err(
        new ConnectionError(`unsupported driver: ${profile.driver}`),
      );
  }
};
