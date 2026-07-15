/**
 * Terminal display-width text helpers. Unlike character-count slicing, these
 * measure each glyph's cell width (CJK is 2-wide), so wrapping and truncation
 * stay inside their visual column budgets. Renderer-free and pure for tests.
 */

import stringWidth from 'string-width';

/**
 * Truncate one line to at most `width` terminal columns, reserving the final
 * column for an ellipsis when anything was removed. This is display-width aware
 * (CJK glyphs count as two), unlike String#slice.
 */
export const truncateByWidth = (line: string, width: number): string => {
  if (width <= 0) return '';
  if (stringWidth(line) <= width) return line;
  if (width === 1) return '…';

  const budget = width - 1;
  let out = '';
  let used = 0;
  for (const ch of line) {
    const w = stringWidth(ch);
    if (used + w > budget) break;
    out += ch;
    used += w;
  }
  return `${out}…`;
};

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
