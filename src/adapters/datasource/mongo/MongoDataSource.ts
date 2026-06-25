/**
 * MongoDataSource — MongoDB as a browsable document store, via the official
 * `mongodb` driver.
 *
 * The other half of the capability litmus test (docs/adr/0005): Mongo is
 * SchemaIntrospectable + Browsable + RowEditable but NOT Queryable (it speaks
 * BSON queries, not SQL) and NOT Transactional (multi-doc transactions need a
 * replica set; single-document updateOne/deleteOne are atomic, so RowEdit is
 * safe without one). Browsing projects documents into the 'document' ResultSet
 * shape: columns are the union of top-level keys across the page; nested
 * values / ObjectId / Date are stringified into cells.
 *
 * Browsable maps cleanly onto find().skip().limit() — exactly as the port's
 * docstring predicted, with zero change to any domain signature.
 */

import {
  MongoClient,
  ObjectId,
  type Db,
  type Document,
  type Filter as MongoFilter,
} from 'mongodb';
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
  CellValue,
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
import type { BrowseSpec, Filter } from '../../../domain/query/Query.ts';
import { ok, err, type Result } from '../../../shared/Result.ts';
import {
  ConnectionError,
  DataSourceError,
} from '../../../domain/errors/errors.ts';

const SAMPLE_SIZE = 50;

export class MongoDataSource
  implements DataSource, SchemaIntrospectable, Browsable, RowEditable
{
  readonly id: string;
  private readonly uri: string;
  private readonly dbName: string;
  private client: MongoClient | null = null;
  private database: Db | null = null;

  constructor(id: string, uri: string, dbName: string) {
    this.id = id;
    this.uri = uri;
    this.dbName = dbName;
  }

  capabilities(): CapabilitySet {
    // Note the omissions: no Query (no SQL), no Transaction (standalone server).
    return new CapabilitySet([
      Capability.SchemaIntrospect,
      Capability.Browse,
      Capability.RowEdit,
    ]);
  }

  async connect(): Promise<Result<void, ConnectionError>> {
    try {
      const client = new MongoClient(this.uri, {
        serverSelectionTimeoutMS: 2000,
      });
      await client.connect();
      const database = client.db(this.dbName);
      await database.command({ ping: 1 });
      this.client = client;
      this.database = database;
      return ok(undefined);
    } catch (e) {
      return err(new ConnectionError(`mongo connect failed: ${message(e)}`));
    }
  }

  async disconnect(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.database = null;
  }

  async ping(): Promise<boolean> {
    try {
      await this.db().command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  // ── SchemaIntrospectable ──────────────────────────────────────────────────

  async introspect(): Promise<SchemaSnapshot> {
    const cols = await this.db().listCollections({}, { nameOnly: true }).toArray();
    const objects: ObjectRef[] = cols
      .map((c) => c.name)
      .sort()
      .map((name) => ({ namespace: this.dbName, name, kind: 'collection' as const }));
    return { objects };
  }

  async describe(ref: ObjectRef): Promise<ObjectSchema> {
    const docs = await this.db()
      .collection(ref.name)
      .find({})
      .limit(SAMPLE_SIZE)
      .toArray();
    const columns: ColumnDef[] = unionColumns(docs).map((name) => ({
      name,
      dataType: inferType(firstDefined(docs, name)),
      nullable: name !== '_id',
      isPrimaryKey: name === '_id',
    }));
    return { ref, columns };
  }

  // ── Browsable ─────────────────────────────────────────────────────────────

  async browse(ref: ObjectRef, spec: BrowseSpec): Promise<ResultSet> {
    const t0 = performance.now();
    const cursor = this.db()
      .collection(ref.name)
      .find(toMongoFilter(spec.filter ?? null))
      .skip(spec.page.offset)
      .limit(spec.page.limit);
    if (spec.sort) {
      cursor.sort({ [spec.sort.column]: spec.sort.direction === 'asc' ? 1 : -1 });
    }
    const docs = await cursor.toArray();
    const names = unionColumns(docs);
    const columns: ColumnMeta[] = names.map((name) => ({
      name,
      dataType: inferType(firstDefined(docs, name)),
    }));
    const rows: Row[] = docs.map((d) => names.map((n) => toCell(d[n])));
    return {
      shape: 'document',
      columns,
      rows,
      truncated: false,
      elapsedMs: Math.round(performance.now() - t0),
    };
  }

  async count(ref: ObjectRef, filter?: Filter | null): Promise<number> {
    return this.db().collection(ref.name).countDocuments(toMongoFilter(filter ?? null));
  }

  // ── RowEditable (single-document ops are atomic; no transaction needed) ────

  async insert(ref: ObjectRef, row: RowPatch): Promise<EditResult> {
    const doc = patchToDoc(row, { includeId: true });
    const r = await this.db().collection(ref.name).insertOne(doc);
    return { affected: r.acknowledged ? 1 : 0 };
  }

  async update(ref: ObjectRef, key: RowKey, patch: RowPatch): Promise<EditResult> {
    const r = await this.db()
      .collection(ref.name)
      .updateOne({ _id: rowId(key) } as MongoFilter<Document>, {
        $set: patchToDoc(patch, { includeId: false }),
      });
    return { affected: r.matchedCount };
  }

  async delete(ref: ObjectRef, key: RowKey): Promise<EditResult> {
    const r = await this.db()
      .collection(ref.name)
      .deleteOne({ _id: rowId(key) } as MongoFilter<Document>);
    return { affected: r.deletedCount };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private db(): Db {
    if (!this.database) throw new DataSourceError('mongo not connected');
    return this.database;
  }
}

// ── projection / coercion (document ⇄ unified cell model) ───────────────────

/** Union of top-level keys across the sampled docs, with `_id` first. */
const unionColumns = (docs: Document[]): string[] => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const d of docs) {
    for (const k of Object.keys(d)) {
      if (!seen.has(k)) {
        seen.add(k);
        names.push(k);
      }
    }
  }
  return seen.has('_id') ? ['_id', ...names.filter((n) => n !== '_id')] : names;
};

const firstDefined = (docs: Document[], name: string): unknown =>
  docs.find((d) => d[name] !== undefined && d[name] !== null)?.[name];

const inferType = (v: unknown): string => {
  if (v instanceof ObjectId) return 'objectId';
  if (v instanceof Date) return 'date';
  if (Array.isArray(v)) return 'array';
  if (v !== null && typeof v === 'object') return 'object';
  return typeof v; // string | number | boolean | …
};

/** Project a BSON/JS value into the unified CellValue model (a flat cell). */
const toCell = (v: unknown): CellValue => {
  if (v === null || v === undefined) return null;
  if (v instanceof ObjectId) return v.toHexString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    return v;
  if (typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  return JSON.stringify(v, jsonReplacer);
};

const jsonReplacer = (_key: string, value: unknown): unknown =>
  value instanceof ObjectId ? value.toHexString() : value;

const field = (fields: ReadonlyArray<FieldValue>, name: string): FieldValue | undefined =>
  fields.find((f) => f.column === name);

/** Convert a row key's `_id` cell (hex string / number) back to a BSON id. */
const rowId = (key: RowKey): unknown => {
  const f = field(key, '_id');
  if (!f) throw new DataSourceError('mongo edit requires the _id key');
  const v = f.value;
  return typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v) ? new ObjectId(v) : v;
};

const patchToDoc = (
  patch: RowPatch,
  opts: { includeId: boolean },
): Record<string, unknown> => {
  const doc: Record<string, unknown> = {};
  for (const f of patch) {
    if (f.column === '_id' && !opts.includeId) continue; // never reassign _id
    doc[f.column] = f.value;
  }
  return doc;
};

/** Translate the source-agnostic Filter into a Mongo query document. */
const toMongoFilter = (filter: Filter | null): Document => {
  if (!filter || filter.conditions.length === 0) return {};
  const clauses = filter.conditions.map((c) => {
    const value = coerce(c.value);
    switch (c.op) {
      case 'contains':
        return { [c.column]: { $regex: c.value, $options: 'i' } };
      case 'eq':
        return { [c.column]: value };
      case 'ne':
        return { [c.column]: { $ne: value } };
      case 'lt':
        return { [c.column]: { $lt: value } };
      case 'lte':
        return { [c.column]: { $lte: value } };
      case 'gt':
        return { [c.column]: { $gt: value } };
      case 'gte':
        return { [c.column]: { $gte: value } };
      default:
        return {};
    }
  });
  return clauses.length === 1 ? clauses[0]! : { $and: clauses };
};

/** Numeric filter values compare as numbers; everything else stays a string. */
const coerce = (value: string): string | number =>
  value !== '' && !Number.isNaN(Number(value)) ? Number(value) : value;

const message = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
