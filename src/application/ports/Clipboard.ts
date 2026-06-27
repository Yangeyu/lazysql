/**
 * Clipboard — outbound port for placing text on the system clipboard.
 *
 * Kept behind the DIP boundary so presentation (the mouse-selection → copy wiring
 * in Root) depends only on this interface, and the composition root injects a
 * concrete adapter. The deliberate choice is the *system* clipboard (a platform
 * CLI), NOT terminal OSC52: a selection then lands in the clipboard in any
 * terminal, with no terminal-side "allow clipboard access" permission to enable.
 */
export interface Clipboard {
  /** Replace the clipboard contents with `text`. Best-effort — never throws. */
  write(text: string): void;
}
