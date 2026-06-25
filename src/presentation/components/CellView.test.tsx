/**
 * CellView render tests: the inspector pretty-prints JSON, shows the column and
 * type header, and windows long values with a scroll indicator.
 */

import React from 'react';
import { test, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { CellView } from './CellView.tsx';

test('pretty-prints a JSON cell with column + type header', () => {
  const { lastFrame } = render(
    <CellView
      column="meta"
      value={'{"k":"v","items":[1,2,3]}'}
      offset={0}
      viewportRows={20}
      viewportCols={60}
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
  const { lastFrame } = render(
    <CellView column="body" value={value} offset={0} viewportRows={10} viewportCols={40} />,
  );
  const frame = (lastFrame() ?? '').replace(/\[[0-9;]*m/g, '');
  expect(frame).toContain('line-0');
  expect(frame).not.toContain('line-40'); // beyond the window
  expect(frame).toContain('more'); // scroll hint
});
