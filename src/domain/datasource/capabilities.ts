/**
 * Capability model — the heart of lazysql's "ask what it can do, not what it
 * is" design. A data source declares which capabilities it implements; the UI
 * enables features by capability, never by database type. Adding a new database
 * means a new adapter declaring its capabilities — no `if (db === 'redis')`
 * branches anywhere in the core. (See docs/adr/0002.)
 */

export const Capability = {
  /** Execute a raw query/command and get back a unified ResultSet. */
  Query: 'query',
  /** Enumerate namespaces, tables/collections, columns, indexes, constraints. */
  SchemaIntrospect: 'schema:introspect',
  /** Read a paginated window of an object's rows/documents (source-agnostic). */
  Browse: 'browse',
  /** Render a browse operation as readable source text (display only). */
  BrowsePreview: 'browse:preview',
  /** Render a catalog DDL operation (e.g. DROP) as a runnable, quoted statement. */
  DdlScript: 'ddl:script',
  /** Row/document level create/update/delete. */
  RowEdit: 'row:edit',
  /** begin/commit/rollback. */
  Transaction: 'transaction',
  /** Cursor/streaming reads so huge results never load fully into memory. */
  Stream: 'stream',
} as const;

export type Capability = (typeof Capability)[keyof typeof Capability];

/** An immutable set of capabilities a data source declares it supports. */
export class CapabilitySet {
  private readonly set: ReadonlySet<Capability>;

  constructor(capabilities: Iterable<Capability>) {
    this.set = new Set(capabilities);
  }

  has(capability: Capability): boolean {
    return this.set.has(capability);
  }

  hasAll(...capabilities: Capability[]): boolean {
    return capabilities.every((c) => this.set.has(c));
  }

  toArray(): Capability[] {
    return [...this.set];
  }
}
