/**
 * DataSourceFactory — maps a ConnectionProfile to a concrete DataSource. This
 * is the single OCP extension point: supporting Postgres/MySQL/Mongo/Redis adds
 * a branch here (plus its adapter), and nothing in domain/application changes.
 * A profile with an `ssh` block is routed through an SSH local port forward
 * first; the tunnel lives exactly as long as the returned DataSource.
 */

import type {
  ConnectionProfile,
  DriverId,
} from '../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../domain/datasource/DataSource.ts';
import { ConnectionError } from '../../domain/errors/errors.ts';
import { ok, err, type Result } from '../../shared/Result.ts';
import { resolveUserPath } from '../../shared/path.ts';
import { SqlDataSource } from './sql/SqlDataSource.ts';
import { SqliteDialect } from './sql/dialects/SqliteDialect.ts';
import { BunSqliteDriver } from './sql/drivers/BunSqliteDriver.ts';
import { PostgresDialect } from './sql/dialects/PostgresDialect.ts';
import { PgDriver, type PgConnectConfig } from './sql/drivers/PgDriver.ts';
import { MySqlDialect } from './sql/dialects/MySqlDialect.ts';
import { MySqlDriver } from './sql/drivers/MySqlDriver.ts';
import type { PoolOptions } from 'mysql2';
import { RedisDataSource } from './redis/RedisDataSource.ts';
import { MongoDataSource } from './mongo/MongoDataSource.ts';
import { SshTunnel } from './tunnel/SshTunnel.ts';

export const createDataSource = async (
  profile: ConnectionProfile,
): Promise<Result<DataSource, ConnectionError>> => {
  if (!profile.ssh) return buildDataSource(profile);

  const target = tunnelTarget(profile);
  if (!target.ok) return target;
  const tunnel = await SshTunnel.open(profile.ssh, target.value);
  if (!tunnel.ok) return tunnel;

  const created = buildDataSource({
    ...profile,
    options: {
      ...profile.options,
      host: '127.0.0.1',
      port: tunnel.value.localPort,
      // The mongo driver discovers replica-set members and dials their REAL
      // addresses, which only resolve from the far side of the tunnel — pin
      // it to the forwarded endpoint instead.
      ...(profile.driver === 'mongodb' ? { directConnection: true } : {}),
    },
  });
  if (!created.ok) {
    tunnel.value.close();
    return created;
  }
  return ok(closingTunnelOnDisconnect(created.value, tunnel.value));
};

const DEFAULT_TARGET_PORT: Record<Exclude<DriverId, 'sqlite'>, number> = {
  postgres: 5432,
  mysql: 3306,
  mongodb: 27017,
  redis: 6379,
};

/** The db endpoint the tunnel must forward to, from the profile's discrete
 *  host/port. URL-form options are rejected: their embedded host can't be
 *  rewritten to the local forward (mongodb+srv can't even name one). */
const tunnelTarget = (
  profile: ConnectionProfile,
): Result<{ host: string; port: number }, ConnectionError> => {
  if (profile.driver === 'sqlite') {
    return err(new ConnectionError('ssh tunnel does not apply to sqlite'));
  }
  const o = profile.options;
  if (o.connectionString !== undefined || o.url !== undefined || o.uri !== undefined) {
    return err(
      new ConnectionError(
        'ssh tunnel requires discrete host/port options, not a connection URL',
      ),
    );
  }
  return ok({
    host: String(o.host ?? 'localhost'),
    port: o.port === undefined ? DEFAULT_TARGET_PORT[profile.driver] : Number(o.port),
  });
};

/** Tie the tunnel's lifetime to the source: disconnect closes both. A Proxy —
 *  not a wrapper object — so the capability guards' duck typing (asQueryable
 *  and friends) still sees the adapter's own methods. */
const closingTunnelOnDisconnect = (
  source: DataSource,
  tunnel: SshTunnel,
): DataSource =>
  new Proxy(source, {
    get(target, prop) {
      if (prop === 'disconnect') {
        return async () => {
          try {
            await target.disconnect();
          } finally {
            tunnel.close();
          }
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });

const buildDataSource = (
  profile: ConnectionProfile,
): Result<DataSource, ConnectionError> => {
  switch (profile.driver) {
    case 'sqlite': {
      const raw = String(profile.options.file ?? '');
      if (!raw) {
        return err(new ConnectionError('sqlite profile requires options.file'));
      }
      // Resolve to absolute so the DB opens the same file regardless of the cwd
      // lazysql was launched from. New profiles are stored absolute already; this
      // also rescues older configs that saved a relative path.
      const file = resolveUserPath(raw);
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

/** Map free-form profile options to a PgConnectConfig (connectionString or
 *  discrete fields), coercing `port` to a number when given as a string. */
const toPoolConfig = (
  options: Readonly<Record<string, unknown>>,
): PgConnectConfig => {
  if (typeof options.connectionString === 'string') {
    return { connectionString: options.connectionString };
  }
  return {
    host: options.host as string | undefined,
    port: options.port === undefined ? undefined : Number(options.port),
    user: options.user as string | undefined,
    password: options.password as string | undefined,
    database: options.database as string | undefined,
  };
};

/** Resolve a mongodb URI + database name from a URI or discrete fields.
 *  Exported for its unit tests only — not part of the adapter's surface. */
export const toMongoConfig = (
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
  const direct = options.directConnection ? '/?directConnection=true' : '';
  return { uri: `mongodb://${auth}${host}:${port}${direct}`, dbName: fromField };
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
