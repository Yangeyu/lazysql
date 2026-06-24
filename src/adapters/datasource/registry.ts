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
import { PostgresDialect } from './sql/dialects/PostgresDialect.ts';
import { PgDriver } from './sql/drivers/PgDriver.ts';
import type { PoolConfig } from 'pg';
import { MySqlDialect } from './sql/dialects/MySqlDialect.ts';
import { MySqlDriver } from './sql/drivers/MySqlDriver.ts';
import type { PoolOptions } from 'mysql2';

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
    case 'postgres': {
      return ok(
        new SqlDataSource(
          profile.id,
          new PgDriver(toPoolConfig(profile.options)),
          new PostgresDialect(),
        ),
      );
    }
    case 'mysql': {
      return ok(
        new SqlDataSource(
          profile.id,
          new MySqlDriver(toMySqlConfig(profile.options)),
          new MySqlDialect(),
        ),
      );
    }
    // Phase 6: case 'mongodb' / 'redis' → MongoDataSource / RedisDataSource
    default:
      return err(
        new ConnectionError(`unsupported driver: ${profile.driver}`),
      );
  }
};

/** Map free-form profile options to a pg PoolConfig (connectionString or
 *  discrete fields), coercing `port` to a number when given as a string. */
const toPoolConfig = (options: Readonly<Record<string, unknown>>): PoolConfig => {
  if (typeof options.connectionString === 'string') {
    return { connectionString: options.connectionString };
  }
  const port =
    options.port === undefined ? undefined : Number(options.port);
  return {
    host: options.host as string | undefined,
    port,
    user: options.user as string | undefined,
    password: options.password as string | undefined,
    database: options.database as string | undefined,
  };
};

/** Map profile options to a mysql2 config (connection URI or discrete fields). */
const toMySqlConfig = (
  options: Readonly<Record<string, unknown>>,
): PoolOptions | string => {
  if (typeof options.connectionString === 'string') return options.connectionString;
  return {
    host: options.host as string | undefined,
    port: options.port === undefined ? undefined : Number(options.port),
    user: options.user as string | undefined,
    password: options.password as string | undefined,
    database: options.database as string | undefined,
  };
};
