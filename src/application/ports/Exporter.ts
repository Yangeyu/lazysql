/**
 * Exporter — outbound port for streaming exported rows to a destination.
 *
 * Behind the DIP boundary so usecases depend only on this interface; the
 * composition root injects a concrete adapter (the filesystem writer). The sink
 * is opened once, fed text chunks (produced by a RowFormatter), then closed.
 *
 * Contract: every method returns a Result and NEVER throws. The adapter should
 * write atomically — stream to a temp file and rename onto the target on close —
 * so a cancelled or failed export leaves no half-written file (`abort` discards
 * the in-progress file). See docs/adr/0012.
 */

import type { Result } from '../../shared/Result.ts';
import type { ExportError } from '../../domain/errors/errors.ts';

/** Where an export is written. v1: a filesystem path (absolute, or relative to
 *  the process CWD — the adapter resolves it and reports the absolute result). */
export interface ExportTarget {
  readonly path: string;
}

/** Outcome of a completed export: rows written and the absolute path written to. */
export interface ExportSummary {
  readonly rows: number;
  readonly path: string;
}

/** An open, streaming destination. `path` is the resolved absolute target. */
export interface ExportSink {
  readonly path: string;
  write(chunk: string): Promise<Result<void, ExportError>>;
  close(): Promise<Result<void, ExportError>>;
  /** Discard the in-progress file (on cancel / error). Best-effort, never throws. */
  abort(): Promise<void>;
}

export interface Exporter {
  open(target: ExportTarget): Promise<Result<ExportSink, ExportError>>;
}
