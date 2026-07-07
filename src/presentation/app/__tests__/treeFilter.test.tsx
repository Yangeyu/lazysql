/**
 * Sidebar filter acceptance: `/` narrows the object tree by name as you type,
 * ⏎ keeps the filter and hands focus back for navigation, esc clears it. Driven
 * through the real App + renderer with a fake introspectable source, so the
 * store's filter state, the keymap context switch, and the native input in the
 * sidebar all run end-to-end (not just the pure projection).
 */

import React from 'react';
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
  id: 'db',
  name: 'shopdb',
  driver: 'sqlite',
  options: { file: ':memory:' },
};

// Two names share the 'user' substring, two don't — so a filter has something to
// keep AND something to drop. Flat (SQLite) tree: root → Tables → objects.
const names = ['users', 'orders', 'products', 'user_roles'];

const fake: DataSource & SchemaIntrospectable = {
  id: 'db',
  connect: async () => ok(undefined),
  disconnect: async () => {},
  ping: async () => true,
  capabilities: () => new CapabilitySet([Capability.SchemaIntrospect]),
  introspect: async () => ({
    objects: names.map((name) => ({ name, kind: 'table' as const })),
  }),
  describe: async () => ({
    ref: { name: 'users', kind: 'table' as const },
    detail: [{ kind: 'columns' as const, columns: [] }],
  }),
};

const service: ConnectionService = {
  list: async () => [profile],
  open: async () => ok(fake),
  save: async () => {},
  remove: async () => {},
};

const render = async () => {
  const store = createAppStore({ connectionService: service, initial: profile });
  const h = await renderTest(
    <StoreContext.Provider value={store}>
      <App clipboard={{ write: () => {} }} />
    </StoreContext.Provider>,
    // Tall enough that all four objects fit — the test is about filtering, not
    // virtualization, so nothing should scroll out of view on its own.
    { width: 100, height: 24 },
  );
  return { h, store };
};

test('/ live-narrows the tree; ⏎ keeps the filter; esc restores the full tree', async () => {
  const { h } = await render();
  await h.until((f) => f.includes('orders')); // full tree after connect

  // Enter the filter input and type — the tree narrows to matching names.
  h.press('/');
  await h.flush(); // let the native <input> mount + take focus
  await h.type('user');
  const narrowed = await h.until((f) => !f.includes('orders'));
  expect(narrowed).toContain('users');
  expect(narrowed).toContain('user_roles');
  expect(narrowed).not.toContain('products'); // dropped — no 'user' substring

  // ⏎ commits: leave the input but keep the filter; a resting reminder shows the
  // needle and the match count, and the non-matches stay hidden.
  h.enter();
  const kept = await h.until((f) => f.includes('/ user'));
  expect(kept).toContain('users');
  expect(kept).not.toContain('orders');
  expect(kept).toContain('(2)'); // users + user_roles

  // esc clears the filter — the full tree comes back.
  h.esc();
  const cleared = await h.until((f) => f.includes('orders'));
  expect(cleared).toContain('products');
  h.cleanup();
});

test('esc while editing the filter cancels it back to the full tree', async () => {
  const { h } = await render();
  await h.until((f) => f.includes('orders'));

  h.press('/');
  await h.flush();
  await h.type('prod');
  await h.until((f) => !f.includes('users')); // narrowed to 'products'

  h.esc(); // clear straight from the input
  const cleared = await h.until((f) => f.includes('users'));
  expect(cleared).toContain('orders');
  expect(cleared).not.toContain('/ prod'); // no resting reminder — filter is gone
  h.cleanup();
});

test('clearing the filter refocuses the object open in the grid, not a stale index', async () => {
  const { h, store } = await render();
  await h.until((f) => f.includes('orders'));

  // Filter to a single object, commit, then open it (grid now shows user_roles).
  h.press('/');
  await h.flush();
  await h.type('user_roles');
  await h.until((f) => !f.includes('orders')); // narrowed to the sole match
  h.enter(); // commit — cursor rests on user_roles
  h.enter(); // open it → current = user_roles, focus moves to the grid
  await h.until(() => store.getState().current?.name === 'user_roles');

  // Return to the sidebar (the filter is still active) and clear it.
  store.getState().focusPane('sidebar');
  h.esc();
  await h.until((f) => f.includes('orders')); // full tree restored

  // The cursor sits on the object that was open — not the index the filtered
  // tree happened to leave behind.
  const rows = store.getState().treeRows();
  const row = rows[store.getState().treeIndex];
  expect(row?.type).toBe('object');
  if (row?.type === 'object') expect(row.ref.name).toBe('user_roles');
  h.cleanup();
});
