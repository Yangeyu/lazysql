/**
 * Schema-tier acceptance: a Postgres connection groups each category's objects
 * under a schema row ([public], [drizzle]); other drivers stay flat. Driven
 * through the real App + renderer with a fake introspectable source, so the
 * store's schema fold/navigation runs end-to-end (not just the pure projection).
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

const pgProfile: ConnectionProfile = {
  id: 'pg',
  name: 'kiwoo_local',
  driver: 'postgres',
  options: { host: 'localhost', database: 'kiwoo' },
};

// A source that only introspects — enough for the sidebar tree. Objects carry a
// `namespace`, the signal the schema tier groups on.
const fakePg: DataSource & SchemaIntrospectable = {
  id: 'pg',
  connect: async () => ok(undefined),
  disconnect: async () => {},
  ping: async () => true,
  capabilities: () => new CapabilitySet([Capability.SchemaIntrospect]),
  introspect: async () => ({
    objects: [
      { name: 'users', kind: 'table', namespace: 'public' },
      { name: 'orders', kind: 'table', namespace: 'public' },
      { name: 'audit', kind: 'table', namespace: 'drizzle' },
    ],
  }),
  describe: async () => ({
    ref: { name: 'users', kind: 'table' as const },
    detail: [{ kind: 'columns' as const, columns: [] }],
  }),
};

const service: ConnectionService = {
  list: async () => [pgProfile],
  open: async () => ok(fakePg),
  save: async () => {},
  remove: async () => {},
};

const render = () => {
  const store = createAppStore({ connectionService: service, initial: pgProfile });
  return renderTest(
    <StoreContext.Provider value={store}>
      <App clipboard={{ write: () => {} }} />
    </StoreContext.Provider>,
    { width: 100, height: 30 },
  );
};

test('a Postgres connection groups objects under a [schema] tier', async () => {
  const h = await render();
  // The first schema is auto-expanded on connect, so its objects show at once.
  await h.until((f) => f.includes('[public]'));
  const frame = h.frame();
  expect(frame).toContain('Tables'); // category header
  expect(frame).toContain('[public]'); // schema tier under it
  expect(frame).toContain('users'); // a public-schema object
  // [drizzle] exists as a (collapsed) sibling schema; its object stays hidden.
  expect(frame).toContain('[drizzle]');
  expect(frame).not.toContain('audit');
  h.cleanup();
});

test('h collapses the schema, then the category, walking the tier up', async () => {
  const h = await render();
  await h.until((f) => f.includes('users')); // cursor seated on the first object
  h.press('h'); // object → jump to parent [public] schema
  h.press('h'); // collapse [public]
  await h.until((f) => !f.includes('users')); // its objects hidden
  expect(h.frame()).toContain('[public]'); // schema row still visible
  expect(h.frame()).toContain('Tables');
  h.cleanup();
});

test('r re-introspects, surfacing an object created since connect', async () => {
  // A source that grows a new table once `created` flips — mimicking a CREATE
  // TABLE run in the editor that the connect-time snapshot can't show.
  let created = false;
  const growing: DataSource & SchemaIntrospectable = {
    ...fakePg,
    introspect: async () => ({
      objects: [
        { name: 'users', kind: 'table', namespace: 'public' },
        ...(created ? [{ name: 'temp_data', kind: 'table' as const, namespace: 'public' }] : []),
      ],
    }),
  };
  const store = createAppStore({
    connectionService: { ...service, open: async () => ok(growing) },
    initial: pgProfile,
  });
  const h = await renderTest(
    <StoreContext.Provider value={store}>
      <App clipboard={{ write: () => {} }} />
    </StoreContext.Provider>,
    { width: 100, height: 30 },
  );
  await h.until((f) => f.includes('users'));
  expect(h.frame()).not.toContain('temp_data'); // not in the connect snapshot

  created = true;
  h.press('r'); // refresh the tree (sidebar is focused after connect)
  await h.until((f) => f.includes('temp_data')); // the new table now shows
  expect(h.frame()).toContain('users'); // existing fold/cursor preserved
  h.cleanup();
});
