import { expect, test } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { Overlay } from '../Overlay.tsx';

test('the panel paints an opaque terminal-default background, frame included', async () => {
  // The workbench behind the overlay uses a custom (rgb-intent) colour: if the
  // panel ever regresses to transparent, that colour leaks into its cells and
  // the default-intent assertions below fail.
  const t = await testRender(
    <box position="relative" width={40} height={12} backgroundColor="#355c7d">
      <text>workbench</text>
      <Overlay termRows={12} termCols={40} width={20} height={6}>
        <text>dialog</text>
      </Overlay>
    </box>,
    { width: 40, height: 12 },
  );

  await t.flush();
  const spans = t.captureSpans().lines.flatMap((line) => line.spans);

  const workbenchSpan = spans.find((span) => span.text.includes('workbench'));
  const borderSpans = spans.filter((span) => /[╭╮╰╯│─]/u.test(span.text));
  const contentSpan = spans.find((span) => span.text.includes('dialog'));
  if (!workbenchSpan || !contentSpan) throw new Error('scene was not rendered');
  expect(borderSpans.length).toBeGreaterThan(0);

  // Sanity: the leak source really renders with a non-default background.
  expect(workbenchSpan.bg.intent).toBe('rgb');

  for (const span of borderSpans) expect(span.bg.intent).toBe('default');
  expect(contentSpan.bg.intent).toBe('default');

  t.renderer.destroy();
});
