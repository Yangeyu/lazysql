import { expect, test } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import type { CapturedSpan } from '@opentui/core';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { DataGrid } from '../DataGrid.tsx';
import { Sidebar } from '../Sidebar.tsx';
import { theme } from '../../theme/theme.ts';

const rgb = (hex: string): number[] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const contrastRatio = (foreground: string, background: string): number => {
  const luminance = (hex: string): number => {
    const [red = 0, green = 0, blue = 0] = rgb(hex).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };

  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

const expectFocused = (span: CapturedSpan | undefined): void => {
  if (!span) throw new Error('focused text was not rendered');
  expect(span.fg.intent).toBe('rgb');
  expect(span.fg.toInts().slice(0, 3)).toEqual(rgb(theme.onAccent));
  expect(span.bg.intent).toBe('rgb');
  expect(span.bg.toInts().slice(0, 3)).toEqual(rgb(theme.accent));
};

test('focus fills keep text contrast above the readable-text threshold', () => {
  expect(contrastRatio(theme.onAccent, theme.accent)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(theme.onAccent, theme.red)).toBeGreaterThanOrEqual(4.5);
});

test('focused grid cell uses explicit readable theme colors', async () => {
  const t = await testRender(
    <DataGrid
      result={{
        shape: 'tabular',
        columns: [{ name: 'id' }, { name: 'name' }],
        rows: [[1, 'Alice']],
        truncated: false,
      }}
      cursor={0}
      selectedCol={1}
      sort={null}
      loading={false}
      hasTable
      viewportRows={4}
      viewportCols={40}
      focused
      onCellClick={() => {}}
    />,
    { width: 40, height: 6 },
  );

  await t.flush();
  const spans = t.captureSpans().lines.flatMap((line) => line.spans);
  expectFocused(spans.find((span) => span.text.includes('Alice')));
  t.renderer.destroy();
});

test('unfocused grid selection keeps a quiet accent foreground', async () => {
  const t = await testRender(
    <DataGrid
      result={{
        shape: 'tabular',
        columns: [{ name: 'id' }, { name: 'name' }],
        rows: [[1, 'Alice']],
        truncated: false,
      }}
      cursor={0}
      selectedCol={1}
      sort={null}
      loading={false}
      hasTable
      viewportRows={4}
      viewportCols={40}
      focused={false}
      onCellClick={() => {}}
    />,
    { width: 40, height: 6 },
  );

  await t.flush();
  const spans = t.captureSpans().lines.flatMap((line) => line.spans);
  const selected = spans.find((span) => span.text.includes('Alice'));
  if (!selected) throw new Error('selected text was not rendered');
  expect(selected.fg.intent).toBe('rgb');
  expect(selected.fg.toInts().slice(0, 3)).toEqual(rgb(theme.accent));
  expect(selected.bg.toInts().slice(0, 3)).not.toEqual(rgb(theme.accent));
  t.renderer.destroy();
});

test('focused query-result row uses explicit readable theme colors', async () => {
  const t = await testRender(
    <DataGrid
      result={{
        shape: 'tabular',
        columns: [{ name: 'name' }, { name: 'email' }],
        rows: [['Alice', 'alice@example.com']],
        truncated: false,
      }}
      cursor={0}
      selectedCol={-1}
      sort={null}
      loading={false}
      hasTable
      viewportRows={4}
      viewportCols={50}
      focused
      onCellClick={() => {}}
    />,
    { width: 50, height: 6 },
  );

  await t.flush();
  const spans = t.captureSpans().lines.flatMap((line) => line.spans);
  expectFocused(spans.find((span) => span.text.includes('Alice')));
  expectFocused(spans.find((span) => span.text.includes('alice@example.com')));
  t.renderer.destroy();
});

test('focused sidebar row uses explicit readable theme colors', async () => {
  const t = await testRender(
    <Sidebar
      rows={[{
        type: 'object',
        ref: { kind: 'table', name: 'users' },
        label: 'users',
        depth: 0,
      }]}
      selectedIndex={0}
      focused
      width={30}
      marks={new Set()}
      viewportRows={4}
      filter=""
      editing={false}
      onRowClick={() => {}}
      onPaneClick={() => {}}
      onScroll={() => {}}
      onFilterInput={() => {}}
      onFilterSubmit={() => {}}
    />,
    { width: 30, height: 6 },
  );

  await t.flush();
  const spans = t.captureSpans().lines.flatMap((line) => line.spans);
  expectFocused(spans.find((span) => span.text.includes('users')));
  t.renderer.destroy();
});

test('selected confirmation choice uses explicit readable theme colors', async () => {
  const t = await testRender(
    <ConfirmDialog
      title="Export users?"
      tone="normal"
      choice={{ label: 'format', options: ['CSV', 'JSON', 'SQL'], selected: 'JSON' }}
      termRows={20}
      termCols={70}
    />,
    { width: 70, height: 20 },
  );

  await t.flush();
  const spans = t.captureSpans().lines.flatMap((line) => line.spans);
  expectFocused(spans.find((span) => span.text.includes('JSON')));
  t.renderer.destroy();
});
