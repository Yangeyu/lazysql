/**
 * Hard-wrap text to a terminal display width. Unlike a character-count split,
 * this measures each glyph's cell width (CJK is 2-wide), so wide text wraps at
 * the panel edge instead of overflowing or being clipped. Renderer-free and
 * pure, so it is unit-testable.
 */

import stringWidth from 'string-width';

/**
 * Split one logical line into display rows no wider than `width` columns,
 * breaking on character boundaries (there is no word wrap — CJK has no spaces and
 * a long token must still fit). An empty line stays a single empty row; a
 * non-positive width returns the line unchanged.
 */
export const wrapByWidth = (line: string, width: number): string[] => {
  if (width <= 0 || line === '') return [line];
  const rows: string[] = [];
  let row = '';
  let used = 0;
  for (const ch of line) {
    const w = stringWidth(ch);
    if (used + w > width && row !== '') {
      rows.push(row);
      row = '';
      used = 0;
    }
    row += ch;
    used += w;
  }
  rows.push(row);
  return rows;
};
