/**
 * CellView render tests: the inspector pretty-prints JSON, shows the column and
 * type header, and windows long values with a scroll indicator.
 *
 * CellView floats via <Overlay> (absolute layers), which only composite when an
 * in-flow ancestor establishes the frame size — in the real app that's the
 * Header/StatusBar column. `mount` reproduces that with a sized relative
 * background, the same shape the App provides.
 */

import React from 'react';
import { test, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { Box, Text } from 'ink';
import { CellView } from './CellView.tsx';

const mount = (rows: number, cols: number, node: React.ReactNode) =>
  render(
    <Box position="relative" width={cols} height={rows} flexDirection="column">
      {Array.from({ length: rows }, (_, i) => (
        <Text key={i}>{'·'.repeat(cols)}</Text>
      ))}
      {node}
    </Box>,
  );

test('pretty-prints a JSON cell with column + type header', () => {
  const { lastFrame } = mount(
    24,
    80,
    <CellView
      column="meta"
      value={'{"k":"v","items":[1,2,3]}'}
      offset={0}
      termRows={24}
      termCols={80}
    />,
  );
  const frame = (lastFrame() ?? '').replace(/\[[0-9;]*m/g, '');
  expect(frame).toContain('cell'); // badge
  expect(frame).toContain('meta'); // column
  expect(frame).toContain('json'); // detected type
  expect(frame).toContain('"k": "v"'); // structured formatting
});

test('windows a tall value and shows a "more" indicator', () => {
  const value = Array.from({ length: 50 }, (_, i) => `line-${i}`).join('\n');
  const { lastFrame } = mount(
    14,
    44,
    <CellView column="body" value={value} offset={0} termRows={14} termCols={44} />,
  );
  const frame = (lastFrame() ?? '').replace(/\[[0-9;]*m/g, '');
  expect(frame).toContain('line-0');
  expect(frame).not.toContain('line-40'); // beyond the window
  expect(frame).toContain('more'); // scroll hint
});

test('the panel is a FIXED size — scrolling does not change its geometry', () => {
  const value = Array.from({ length: 50 }, (_, i) => `line-${i}`).join('\n');
  const cell = (offset: number) => (
    <CellView column="body" value={value} offset={offset} termRows={20} termCols={50} />
  );
  const dims = (offset: number): [number, number] => {
    const f = (mount(20, 50, cell(offset)).lastFrame() ?? '').replace(
      /\[[0-9;]*m/g,
      '',
    );
    const lines = f.split('\n');
    return [lines.length, Math.max(...lines.map((l) => l.length))];
  };
  // Same number of rows and same width at offset 0 and offset 10 → no reflow,
  // which is exactly what keeps Ink on the flicker-free incremental path.
  expect(dims(0)).toEqual(dims(10));
});
