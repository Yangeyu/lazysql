/**
 * RedisDataSource — Redis as a browsable key/value store, via Bun's built-in
 * RedisClient (zero external dependency).
 *
 * Half of the capability model's litmus test (docs/adr/0005): Redis is
 * SchemaIntrospectable + Browsable + RowEditable but deliberately NOT Queryable
 * (it speaks commands, not SQL) and NOT Transactional (MULTI/EXEC has no
 * rollback). The UI gates the SQL editor on the Query capability, so the absence
 * never leaks into the core — the adapter simply declares less.
 *
 * Mapping: Redis' flat keyspace is grouped into browsable "keyspace" objects by
 * the prefix before the first ':'. Each row is (key, type, ttl, value-preview),
 * so the ResultSet shape is 'keyvalue'. KEYS-based scanning is capped (dev-scale
 * tool); offset/limit pagination is applied in memory over the matched keys.
 */

import { RedisClient } from 'bun';
import type {
  DataSource,
  SchemaIntrospectable,
  Browsable,
  RowEditable,
} from '../../../domain/datasource/DataSource.ts';
import {
  Capability,
  CapabilitySet,
} from '../../../domain/datasource/capabilities.ts';
import type {
  ResultSet,
  ColumnMeta,
  Row,
} from '../../../domain/datasource/ResultSet.ts';
import type {
  SchemaSnapshot,
  ObjectRef,
  ObjectSchema,
  ColumnDef,
} from '../../../domain/datasource/schema.ts';
import type {
  RowKey,
  RowPatch,
  EditResult,
  FieldValue,
} from '../../../domain/datasource/edit.ts';
import type { BrowseSpec, Filter, Sort } from '../../../domain/query/Query.ts';
import { ok, err, type Result } from '../../../shared/Result.ts';
import {
  ConnectionError,
  DataSourceError,
} from '../../../domain/errors/errors.ts';

const ROOT = '(root)';
const MAX_KEYS = 5000;
const VALUE_PREVIEW = 200;

const COLUMNS: ColumnMeta[] = [
  { name: 'key', dataType: 'string' },
  { name: 'type', dataType: 'string' },
  { name: 'ttl', dataType: 'integer' },
  { name: 'value', dataType: 'string' },
];

const SCHEMA_COLUMNS: ColumnDef[] = [
  { name: 'key', dataType: 'string', nullable: false, isPrimaryKey: true },
  { name: 'type', dataType: 'string', nullable: false, isPrimaryKey: false },
  { name: 'ttl', dataType: 'integer', nullable: true, isPrimaryKey: false },
  { name: 'value', dataType: 'string', nullable: true, isPrimaryKey: false },
];

const CONNECT_OPTS = {
  connectionTimeout: 2000,
  autoReconnect: false,
  maxRetries: 1,
  enableOfflineQueue: false,
} as const;

export class RedisDataSource
  implements DataSource, SchemaIntrospectable, Browsable, RowEditable
{
  readonly id: string;
  private readonly url: string;
  private client: RedisClient | null = null;

  constructor(id: string, url: string) {
    this.id = id;
    this.url = url;
  }

  capabilities(): CapabilitySet {
    // Note the omissions: no Query (no SQL), no Transaction (no rollback).
    return new CapabilitySet([
      Capability.SchemaIntrospect,
      Capability.Browse,
      Capability.RowEdit,
    ]);
  }

  async connect(): Promise<Result<void, ConnectionError>> {
    try {
      const client = new RedisClient(this.url, CONNECT_OPTS);
      await client.connect();
      await client.send('PING', []);
      this.client = client;
      return ok(undefined);
    } catch (e) {
      return err(new ConnectionError(`redis connect failed: ${message(e)}`));
    }
  }

  async disconnect(): Promise<void> {
    this.client?.close();
    this.client = null;
  }

  async ping(): Promise<boolean> {
    try {
      return String(await this.db().send('PING', [])).toUpperCase() === 'PONG';
    } catch {
      return false;
    }
  }

  // ── SchemaIntrospectable ──────────────────────────────────────────────────

  async introspect(): Promise<SchemaSnapshot> {
    const prefixes = new Set<string>();
    for (const k of await this.db().keys('*')) {
      const i = k.indexOf(':');
      prefixes.add(i === -1 ? ROOT : k.slice(0, i));
    }
    const objects: ObjectRef[] = [...prefixes]
      .sort()
      .map((name) => ({ name, kind: 'keyspace' as const }));
    return { objects };
  }

  async describe(ref: ObjectRef): Promise<ObjectSchema> {
    return { ref, detail: [{ kind: 'columns', columns: SCHEMA_COLUMNS }] };
  }

  // ── Browsable ─────────────────────────────────────────────────────────────

  async browse(ref: ObjectRef, spec: BrowseSpec): Promise<ResultSet> {
    const t0 = performance.now();
    let keys = sortKeys(filterKeys(await this.keysFor(ref), spec.filter), spec.sort);
    const capped = keys.length > MAX_KEYS;
    if (capped) keys = keys.slice(0, MAX_KEYS);

    const window = keys.slice(
      spec.page.offset,
      spec.page.offset + spec.page.limit,
    );
    const rows: Row[] = [];
    for (const key of window) {
      const type = String(await this.db().send('TYPE', [key]));
      const ttl = await this.db().ttl(key);
      rows.push([key, type, ttl, await this.preview(key, type)]);
    }
    return {
      shape: 'keyvalue',
      columns: COLUMNS,
      rows,
      truncated: capped,
      elapsedMs: Math.round(performance.now() - t0),
    };
  }

  async count(ref: ObjectRef, filter?: Filter | null): Promise<number> {
    return filterKeys(await this.keysFor(ref), filter ?? null).length;
  }

  // ── RowEditable (single-key ops are atomic; no transaction needed) ─────────

  async insert(_ref: ObjectRef, row: RowPatch): Promise<EditResult> {
    const key = field(row, 'key');
    if (!key) throw new DataSourceError('redis insert requires a "key" value');
    await this.db().set(key, field(row, 'value') ?? '');
    return { affected: 1 };
  }

  async update(
    _ref: ObjectRef,
    key: RowKey,
    patch: RowPatch,
  ): Promise<EditResult> {
    const name = field(key, 'key');
    if (!name) throw new DataSourceError('redis update requires the row key');
    for (const f of patch) {
      if (f.column === 'value') {
        await this.db().set(name, String(f.value ?? ''));
      } else if (f.column === 'ttl') {
        const n = Number(f.value);
        if (Number.isFinite(n) && n >= 0) await this.db().expire(name, n);
        else await this.db().send('PERSIST', [name]);
      } else if (f.column === 'key') {
        const to = String(f.value);
        if (to && to !== name) await this.db().send('RENAME', [name, to]);
      } else {
        throw new DataSourceError(`redis: column "${f.column}" is not editable`);
      }
    }
    return { affected: 1 };
  }

  async delete(_ref: ObjectRef, key: RowKey): Promise<EditResult> {
    const name = field(key, 'key');
    if (!name) throw new DataSourceError('redis delete requires the row key');
    return { affected: await this.db().del(name) };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private db(): RedisClient {
    if (!this.client) throw new DataSourceError('redis not connected');
    return this.client;
  }

  private async keysFor(ref: ObjectRef): Promise<string[]> {
    if (ref.name === ROOT) {
      return (await this.db().keys('*')).filter((k) => !k.includes(':'));
    }
    return this.db().keys(`${ref.name}:*`);
  }

  private async preview(key: string, type: string): Promise<string> {
    try {
      if (type === 'string') {
        const v = (await this.db().get(key)) ?? '';
        return v.length > VALUE_PREVIEW ? `${v.slice(0, VALUE_PREVIEW)}…` : v;
      }
      const sizeCmd: Record<string, string> = {
        hash: 'HLEN',
        list: 'LLEN',
        set: 'SCARD',
        zset: 'ZCARD',
      };
      const cmd = sizeCmd[type];
      if (cmd) return `(${type}: ${await this.db().send(cmd, [key])})`;
      return `(${type})`;
    } catch {
      return `(${type})`;
    }
  }
}

const field = (fields: ReadonlyArray<FieldValue>, name: string): string | null => {
  const f = fields.find((x) => x.column === name);
  return f === undefined || f.value === null || f.value === undefined
    ? null
    : String(f.value);
};

/**
 * Filter the matched keys before pagination. Only conditions on the "key" column
 * are honoured (Redis filters by key name); conditions on derived columns
 * (type/ttl/value) are ignored. (docs/adr/0005)
 */
const filterKeys = (
  keys: string[],
  filter: Filter | null | undefined,
): string[] => {
  const conds = filter?.conditions.filter((c) => c.column === 'key') ?? [];
  if (conds.length === 0) return keys;
  return keys.filter((k) =>
    conds.every((c) => {
      switch (c.op) {
        case 'contains':
          return k.includes(c.value);
        case 'eq':
          return k === c.value;
        case 'ne':
          return k !== c.value;
        default:
          return true;
      }
    }),
  );
};

const sortKeys = (keys: string[], sort: Sort | null | undefined): string[] => {
  const sorted = [...keys].sort();
  return sort?.column === 'key' && sort.direction === 'desc'
    ? sorted.reverse()
    : sorted;
};

const message = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
