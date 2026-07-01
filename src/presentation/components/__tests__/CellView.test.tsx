/**
 * CellView render tests: the inspector pretty-prints JSON, shows the column and
 * type header, and windows long values with a scroll indicator.
 *
 * CellView floats via <Overlay> (an absolute box). `mount` gives it a sized
 * relative background — the same shape the App provides — so the overlay
 * composites over visible content.
 */

import React from 'react';
import { test, expect } from 'bun:test';
import { renderTest } from '../../testing/renderTest.ts';
import { CellView } from '../CellView.tsx';

const mount = (rows: number, cols: number, node: React.ReactNode) =>
  renderTest(
    <box position="relative" width={cols} height={rows} flexDirection="column">
      {Array.from({ length: rows }, (_, i) => (
        <text key={i}>{'·'.repeat(cols)}</text>
      ))}
      {node}
    </box>,
    { width: cols, height: rows },
  );

test('pretty-prints a JSON cell with column + type header', async () => {
  const h = await mount(
    24,
    80,
    <CellView
      column="meta"
      value={'{"k":"v","items":[1,2,3]}'}
      offset={0}
      mode="view"
      termRows={24}
      termCols={80}
      onScroll={() => {}}
      onEditSubmit={() => {}}
    />,
  );
  await h.flush();
  const frame = h.frame();
  expect(frame).toContain('cell'); // badge
  expect(frame).toContain('meta'); // column
  expect(frame).toContain('json'); // detected type
  expect(frame).toContain('"k": "v"'); // structured formatting
  h.cleanup();
});

test('windows a tall value and shows a "more" indicator', async () => {
  const value = Array.from({ length: 50 }, (_, i) => `line-${i}`).join('\n');
  const h = await mount(
    14,
    44,
    <CellView column="body" value={value} offset={0} mode="view" termRows={14} termCols={44} onScroll={() => {}} onEditSubmit={() => {}} />,
  );
  await h.flush();
  const frame = h.frame();
  expect(frame).toContain('line-0');
  expect(frame).not.toContain('line-40'); // beyond the window
  expect(frame).toContain('more'); // scroll hint
  h.cleanup();
});

test('the panel is a FIXED size — scrolling does not change its geometry', async () => {
  const value = Array.from({ length: 50 }, (_, i) => `line-${i}`).join('\n');
  const cell = (offset: number) => (
    <CellView column="body" value={value} offset={offset} mode="view" termRows={20} termCols={50} onScroll={() => {}} onEditSubmit={() => {}} />
  );
  const dims = async (offset: number): Promise<[number, number]> => {
    const h = await mount(20, 50, cell(offset));
    await h.flush();
    const lines = h.frame().split('\n');
    h.cleanup();
    return [lines.length, Math.max(...lines.map((l) => l.length))];
  };
  // Same rows and width at offset 0 and offset 10 → no reflow when scrolling.
  expect(await dims(0)).toEqual(await dims(10));
});

test('edit mode seeds the textarea with the RAW value (not pretty-printed)', async () => {
  const h = await mount(
    16,
    60,
    <CellView
      column="meta"
      value={'{"k":"v"}'}
      offset={0}
      mode="edit"
      termRows={16}
      termCols={60}
      onScroll={() => {}}
      onEditSubmit={() => {}}
    />,
  );
  await h.flush();
  const frame = h.frame();
  expect(frame).toContain('{"k":"v"}'); // raw, verbatim
  expect(frame).not.toContain('"k": "v"'); // NOT the view-mode pretty form
  expect(frame).toContain('save'); // edit footer
  h.cleanup();
});
