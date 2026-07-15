/**
 * Sidebar virtualization acceptance: a connection with more objects than the
 * sidebar body is tall must SCROLL — the cursor stays visible as it moves past
 * the fold, and rows above it leave the window. Regression guard for the bug
 * where the sidebar rendered every row and overflowed its pane.
 */

import { test, expect } from 'bun:test';
import { renderTest } from '../../testing/renderTest.ts';
import { StoreContext } from '../context.ts';
import { App } from '../App.tsx';
import { createAppStore } from '../store.ts';
import { ok } from '../../../shared/Result.ts';
import { CapabilitySet, Capability } from '../../../domain/datasource/capabilities.ts';
import type { DataSource, SchemaIntrospectable } from '../../../domain/datasource/DataSource.ts';
import type { ConnectionProfile } from '../../../domain/connection/ConnectionProfile.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';

const profile: ConnectionProfile = {
  id: 'many',
  name: 'manydb',
  driver: 'sqlite',
  options: { file: ':memory:' },
};

// 30 tables — far more than fit a short sidebar — so windowing is forced. A flat
// (non-Postgres) driver keeps the tree shallow: root → Tables → the objects.
const names = Array.from({ length: 30 }, (_, i) => `t${String(i).padStart(2, '0')}`);

const fake: DataSource & SchemaIntrospectable = {
  id: 'many',
  connect: async () => ok(undefined),
  disconnect: async () => {},
  ping: async () => true,
  capabilities: () => new CapabilitySet([Capability.SchemaIntrospect]),
  introspect: async () => ({
    objects: names.map((name) => ({ name, kind: 'table' as const })),
  }),
  describe: async () => ({
    ref: { name: 't00', kind: 'table' as const },
    detail: [{ kind: 'columns' as const, columns: [] }],
  }),
};

const service: ConnectionService = {
  list: async () => [profile],
  open: async () => ok(fake),
  save: async () => {},
  remove: async () => {},
};

const render = () => {
  const store = createAppStore({ connectionService: service, initial: profile });
  return renderTest(
    <StoreContext.Provider value={store}>
      <App clipboard={{ write: () => {} }} />
    </StoreContext.Provider>,
    // height 12 → sidebarRows = 7: t00 and t29 cannot both be on screen.
    { width: 100, height: 12 },
  );
};

test('the sidebar scrolls the cursor into view, leaving early rows behind', async () => {
  const h = await render();
  // Tables auto-expands on connect, so the first objects show at the top.
  await h.until((f) => f.includes('t00'));
  expect(h.frame()).not.toContain('t29'); // far object is below the fold

  // Walk the cursor to the very last object (past the end clamps on it).
  for (let i = 0; i < names.length + 2; i++) h.arrow('down');
  await h.flush();

  const frame = h.frame();
  expect(frame).toContain('t29'); // the cursor row scrolled into view…
  expect(frame).not.toContain('t00'); // …and the first object scrolled off
  h.cleanup();
});

test('the wheel scrolls the sidebar the same way the keys do', async () => {
  const h = await render();
  await h.until((f) => f.includes('t00'));
  expect(h.frame()).not.toContain('t29');

  // Wheel down inside the sidebar pane (x within SIDEBAR_WIDTH, y past the title).
  // Flush per notch — each real wheel event is discrete, with a render between.
  for (let i = 0; i < names.length + 2; i++) {
    await h.scroll(4, 6, 'down');
    await h.flush();
  }

  expect(h.frame()).toContain('t29'); // wheel moved the cursor and the view followed
  h.cleanup();
});
