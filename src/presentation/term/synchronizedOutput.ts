/**
 * Synchronized output (DEC private mode 2026) — the terminal-flicker fix.
 *
 * Ink has NO cell-level diffing: on every render it erases the previous frame
 * and repaints the whole thing in a SINGLE write() (log-update emits
 * `eraseLines(prev) + frame` together). On a fast scroll that erase→repaint is
 * not atomic, so the blank intermediate state flashes — the flicker.
 *
 * Mode 2026 tells the terminal "buffer everything between BEGIN and END and
 * apply it in one paint". Wrapping each frame in the markers makes the
 * erase+repaint atomic, removing the flash. Each Ink frame is exactly one
 * write() call, so we wrap per write; each wrap self-closes, so 2026 is never
 * left enabled between frames. Terminals without 2026 ignore the markers
 * (graceful no-op) — supported by iTerm2, Ghostty, kitty, WezTerm, VSCode, tmux.
 *
 * This lives in its own module (not inline in the composition root) so the
 * wrap/restore contract is unit-tested directly — it monkey-patches a stream's
 * `write`, which must be reversible exactly.
 */

export const SYNC_BEGIN = '\x1b[?2026h';
export const SYNC_END = '\x1b[?2026l';

/** Wrap one frame so the terminal applies it atomically. Pure. */
export const wrapFrame = (frame: string): string => SYNC_BEGIN + frame + SYNC_END;

/**
 * Patch `stream.write` so every string frame is wrapped in 2026 markers; returns
 * a restore function that puts the original `write` back exactly. Non-string
 * writes (raw byte buffers) pass through untouched.
 */
export const enableSynchronizedOutput = (
  stream: NodeJS.WriteStream,
): (() => void) => {
  type WriteFn = (chunk: unknown, ...rest: unknown[]) => boolean;
  const original = stream.write; // restore target (the original bound method)
  const passthrough = original.bind(stream) as WriteFn;
  const wrapped: WriteFn = (chunk, ...rest) =>
    typeof chunk === 'string'
      ? passthrough(wrapFrame(chunk), ...rest)
      : passthrough(chunk, ...rest);
  stream.write = wrapped as unknown as typeof stream.write;
  return () => {
    stream.write = original;
  };
};
