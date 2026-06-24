/**
 * Query value objects. `Query` carries raw text plus positional parameters so
 * adapters can bind safely (no string interpolation). `Page` expresses the
 * pagination discipline that keeps the TUI fast: we never fetch more than a
 * window at a time. (See docs/ARCHITECTURE.md §6.4.)
 */

export interface Query {
  readonly text: string;
  readonly params?: ReadonlyArray<unknown>;
}

export const sql = (text: string, params?: ReadonlyArray<unknown>): Query => ({
  text,
  params,
});

export interface Page {
  readonly offset: number;
  readonly limit: number;
}

export const firstPage = (limit: number): Page => ({ offset: 0, limit });

export const nextPage = (page: Page): Page => ({
  offset: page.offset + page.limit,
  limit: page.limit,
});

export const prevPage = (page: Page): Page => ({
  offset: Math.max(0, page.offset - page.limit),
  limit: page.limit,
});
