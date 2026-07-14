/**
 * AppError — what the store's `error` field holds: the one-line text the status
 * bar shows, plus the driver's own facts (code / detail / original message) the
 * `!` details overlay reveals in full. Build one with `appError` (a plain UI
 * message with nothing behind it) or `fromError` (carry a failed operation's
 * DataSourceError, optionally rewording its one-liner).
 */

import { QueryError, type DataSourceError } from '../../domain/errors/errors.ts';

export interface AppError {
  /** The one-line text the status bar shows. */
  readonly message: string;
  /** The driver's native error code (e.g. a Postgres SQLSTATE like `23503`). */
  readonly code?: string;
  /** The driver's supplementary explanation, verbatim (possibly multi-line). */
  readonly detail?: string;
  /** The driver's original message, when `message` was reworded by the UI. */
  readonly raw?: string;
}

export const appError = (message: string): AppError => ({ message });

/** Whether an error wants its dialog: there IS one and it isn't the one the
 *  user dismissed. Derived — a new error (a fresh object) pops the dialog by
 *  construction, clearing the error hides it, and no set site has to manage
 *  an open/closed flag. */
export const errorShowing = (s: {
  readonly error: AppError | null;
  readonly errorDismissed: AppError | null;
}): boolean => s.error !== null && s.error !== s.errorDismissed;

/** Whether the error dialog is the ACTIVE floating layer: an undismissed error
 *  and no higher-precedence overlay (a staged confirm, the connection form) on
 *  screen. The one predicate BOTH the renderer (App's overlay chain) and the
 *  key dispatcher use, so what swallows input is exactly what is visible. */
export const errorDialogShowing = (s: {
  readonly error: AppError | null;
  readonly errorDismissed: AppError | null;
  readonly mode: string;
  readonly pending: unknown;
  readonly connForm: unknown;
}): boolean =>
  errorShowing(s) && !(s.mode === 'confirm' && s.pending != null) && s.connForm == null;

export const fromError = (e: DataSourceError, message?: string): AppError => ({
  message: message ?? e.message,
  ...(e instanceof QueryError && e.code !== undefined ? { code: e.code } : {}),
  ...(e instanceof QueryError && e.detail !== undefined ? { detail: e.detail } : {}),
  ...(message !== undefined && message !== e.message ? { raw: e.message } : {}),
});
