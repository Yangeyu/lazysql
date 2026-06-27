/**
 * Keyboard input adapter — the single seam that turns OpenTUI's `KeyEvent` into
 * the one question the editable fields ask: "what character did the user just
 * type?". OpenTUI hands a `KeyEvent` whose `sequence` carries the literal decoded
 * bytes (but no ready-made character field), so we read the typed glyph from
 * there. Keeping this here (not inline in App's dispatch) makes
 * the input contract unit-testable and keeps terminal-decoding out of the UI.
 */

import type { KeyEvent } from '@opentui/core';

/**
 * The literal character a key press would insert into a text field, or `null`
 * when the press is not text entry — a modifier chord (⌃/⌥/meta), a named or
 * control key, escape, etc. Reads `sequence` so shifted symbols and capitals are
 * exact; `space` is the one named key that still produces a glyph.
 *
 * It doubles as the matcher for single-character shortcuts
 * (`printableChar(key) === ':'`): a chord like ⌃c yields `null`, so it can never
 * collide with the plain `c` binding the way a raw `key.name === 'c'` check would.
 */
export const printableChar = (key: KeyEvent): string | null => {
  if (key.ctrl || key.meta || key.option) return null;
  if (key.name === 'space') return ' ';
  const s = key.sequence;
  if (!s) return null;
  const cp = s.codePointAt(0);
  if (cp === undefined || cp < 0x20 || cp === 0x7f) return null; // control byte
  return s;
};
