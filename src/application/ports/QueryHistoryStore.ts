/**
 * QueryHistoryStore — durably persists each connection's SQL editor history,
 * keyed by connection id, so it survives across runs. The store owns the live
 * in-memory list (↑/↓ navigation); this port is the persistence side-channel.
 *
 * Contract: implementations persist the list verbatim — the caller has already
 * de-duplicated and capped it. History is best-effort: a missing or unreadable
 * store reads as empty, and callers ignore save rejections, so persistence
 * never blocks or fails a query.
 */

export interface QueryHistoryStore {
  /** The persisted statements for a connection, oldest→newest; [] if none. */
  load(connectionId: string): Promise<string[]>;
  /** Replace a connection's persisted history with the (already shaped) list. */
  save(connectionId: string, history: readonly string[]): Promise<void>;
}
