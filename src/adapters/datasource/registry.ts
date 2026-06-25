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
import { RedisDataSource } from './redis/RedisDataSource.ts';
import { MongoDataSource } from './mongo/MongoDataSource.ts';

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
    case 'redis': {
      return ok(new RedisDataSource(profile.id, toRedisUrl(profile.options)));
    }
    case 'mongodb': {
      const { uri, dbName } = toMongoConfig(profile.options);
      if (!dbName) {
        return err(
          new ConnectionError('mongodb profile requires options.database'),
        );
      }
      return ok(new MongoDataSource(profile.id, uri, dbName));
    }
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

/** Resolve a mongodb URI + database name from a URI or discrete fields. */
const toMongoConfig = (
  options: Readonly<Record<string, unknown>>,
): { uri: string; dbName: string } => {
  const explicit = (options.connectionString ?? options.uri) as
    | string
    | undefined;
  const fromField = options.database ? String(options.database) : '';
  if (explicit) {
    return { uri: explicit, dbName: fromField || dbFromUri(explicit) };
  }
  const host = (options.host as string | undefined) ?? 'localhost';
  const port = options.port === undefined ? 27017 : Number(options.port);
  const user = options.user ? encodeURIComponent(String(options.user)) : '';
  const password = options.password
    ? encodeURIComponent(String(options.password))
    : '';
  const auth = user ? `${user}:${password}@` : '';
  return { uri: `mongodb://${auth}${host}:${port}`, dbName: fromField };
};

/** Extract the default database name from a mongodb:// URI path, if present. */
const dbFromUri = (uri: string): string => {
  const m = /mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/.exec(uri);
  return m?.[1] ? decodeURIComponent(m[1]) : '';
};

/** Build a redis:// URL from a connection URL or discrete host/port/db fields. */
const toRedisUrl = (options: Readonly<Record<string, unknown>>): string => {
  if (typeof options.url === 'string') return options.url;
  if (typeof options.connectionString === 'string') return options.connectionString;
  const host = (options.host as string | undefined) ?? 'localhost';
  const port = options.port === undefined ? 6379 : Number(options.port);
  const db = options.db === undefined ? '' : `/${Number(options.db)}`;
  const user = options.user ? String(options.user) : '';
  const password = options.password ? String(options.password) : '';
  const auth = password ? `${user}:${password}@` : user ? `${user}@` : '';
  return `redis://${auth}${host}:${port}${db}`;
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
