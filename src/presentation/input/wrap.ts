/**
 * Cursor-aware word wrap — lays a TextField's value out into display lines and
 * reports which line/column the cursor lands on, so a multi-line editor can draw
 * the caret at the right spot instead of only at the end. Greedy word wrap,
 * hard-breaking any word longer than the width; whitespace is kept (never
 * dropped at a break), so the lines concatenate back to the exact value — which
 * is what lets the cursor index map cleanly onto (line, column).
 */

import stringWidth from 'string-width';

export interface WrappedField {
  readonly lines: string[];
  /** Visible line the cursor sits on. */
  readonly caretLine: number;
  /** Character offset of the cursor within that line (split the line here). */
  readonly caretCol: number;
}

/** Greedy wrap to an exact display width. Invariant: `lines.join('') === text`. */
const wrap = (text: string, width: number): string[] => {
  const w = Math.max(1, width);
  const lines: string[] = [];
  let line = '';
  let lineW = 0;
  const flush = () => {
    lines.push(line);
    line = '';
    lineW = 0;
  };
  for (const token of text.split(/(\s+)/)) {
    if (token === '') continue;
    const tw = stringWidth(token);
    if (lineW > 0 && lineW + tw > w) flush();
    if (tw <= w) {
      line += token;
      lineW += tw;
    } else {
      for (const ch of token) {
        const cw = stringWidth(ch);
        if (lineW + cw > w) flush();
        line += ch;
        lineW += cw;
      }
    }
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
};

/** Wrap `value` to `width` and locate `cursor` within the resulting lines. */
export const wrapWithCursor = (value: string, cursor: number, width: number): WrappedField => {
  const lines = wrap(value, width);
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i]!.length;
    // `<=` so a cursor at a soft break shows at the end of the line just typed,
    // not the start of the next one.
    if (cursor <= acc + len) return { lines, caretLine: i, caretCol: cursor - acc };
    acc += len;
  }
  const last = lines.length - 1;
  return { lines, caretLine: last, caretCol: lines[last]?.length ?? 0 };
};
