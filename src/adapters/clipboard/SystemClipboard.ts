/**
 * SystemClipboard — writes to the OS clipboard via the platform's CLI
 * (pbcopy / xclip / clip). This is the one place that knows those commands; the
 * rest of the app sees only the `Clipboard` port. Best-effort by design: an
 * unsupported platform or a missing tool no-ops rather than throwing, because a
 * failed copy must never disrupt the TUI.
 */

import type { Clipboard } from '../../application/ports/Clipboard.ts';

/** The clipboard-write command for a platform, or null when unsupported. Pure,
 *  so the platform mapping is unit-testable without spawning anything. */
export const clipboardCommand = (
  platform: NodeJS.Platform,
): readonly string[] | null =>
  platform === 'darwin'
    ? ['pbcopy']
    : platform === 'linux'
      ? ['xclip', '-selection', 'clipboard']
      : platform === 'win32'
        ? ['clip']
        : null;

export const createSystemClipboard = (): Clipboard => ({
  write: (text) => {
    const cmd = clipboardCommand(process.platform);
    if (!cmd || text.length === 0) return;
    try {
      Bun.spawn([...cmd], {
        stdin: new Blob([text]),
        stdout: 'ignore',
        stderr: 'ignore',
      });
    } catch {
      /* clipboard tool unavailable — best-effort, skip */
    }
  },
});
