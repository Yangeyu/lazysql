/**
 * A minimal `Result<T, E>` for explicit, typed error handling at layer
 * boundaries — instead of throwing across the domain/adapter seam.
 *
 * Inner layers return `Result` so callers must consciously handle failure;
 * only the outermost edges (composition root, TUI) decide how to surface it.
 */

export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(
  r: Result<T, E>,
): r is { ok: true; value: T } => r.ok;

export const isErr = <T, E>(
  r: Result<T, E>,
): r is { ok: false; error: E } => !r.ok;

/** Unwrap or throw — use only at the very edge (e.g. seed scripts, tests). */
export const unwrap = <T, E>(r: Result<T, E>): T => {
  if (r.ok) return r.value;
  throw r.error instanceof Error ? r.error : new Error(String(r.error));
};
