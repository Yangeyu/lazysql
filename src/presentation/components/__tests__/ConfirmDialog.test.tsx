/**
 * The confirm dialog echoes the exact SQL it will run and, for a CASCADE, lists
 * every dependent object it would also drop — so the user approves with full
 * sight of the blast radius. Rendered through the OpenTUI test renderer.
 */

import { test, expect } from 'bun:test';
import { renderTest } from '../../testing/renderTest.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

test('a danger CASCADE confirm shows the statement and names every dependent', async () => {
  const h = await renderTest(
    <ConfirmDialog
      title="Other objects depend on it — drop them too?"
      statement={'DROP TABLE "public"."widget" CASCADE;'}
      details={['view order_summary', 'view audit_log']}
      tone="danger"
      termRows={24}
      termCols={90}
    />,
    { width: 90, height: 24 },
  );
  await h.flush();
  await h.flush();
  const frame = h.frame();
  expect(frame).toContain('⚠ confirm'); // danger emphasis
  expect(frame).toContain('drop them too?');
  expect(frame).toContain('DROP TABLE "public"."widget" CASCADE;'); // exact SQL echoed
  expect(frame).toContain('also drops:');
  expect(frame).toContain('view order_summary');
  expect(frame).toContain('view audit_log');
  expect(frame).toContain('y confirm');
  h.cleanup();
});

test('a normal confirm omits the danger marker and the dependents block', async () => {
  const h = await renderTest(
    <ConfirmDialog
      title="Update name in users?"
      statement="UPDATE users SET name = 'x' WHERE id=1"
      tone="normal"
      termRows={24}
      termCols={90}
    />,
    { width: 90, height: 24 },
  );
  await h.flush();
  await h.flush();
  const frame = h.frame();
  expect(frame).toContain('Update name in users?');
  expect(frame).not.toContain('⚠');
  expect(frame).not.toContain('also drops:');
  h.cleanup();
});
