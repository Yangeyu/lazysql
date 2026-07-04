/**
 * browseTable must trap adapter rejections into an err Result: an escaped
 * rejection becomes an unhandled promise rejection in the UI, which pops
 * OpenTUI's (undismissable) console overlay instead of the status bar.
 */

import { test, expect } from 'bun:test';
import { browseTable } from '../BrowseTable.ts';
import { QueryError } from '../../../domain/errors/errors.ts';
import type { DataSource, Browsable } from '../../../domain/datasource/DataSource.ts';
import { firstPage } from '../../../domain/query/Query.ts';
import { CapabilitySet, Capability } from '../../../domain/datasource/capabilities.ts';
import { ok } from '../../../shared/Result.ts';

const failing: DataSource & Browsable = {
  id: 'fake',
  connect: async () => ok(undefined),
  disconnect: async () => {},
  ping: async () => true,
  capabilities: () => new CapabilitySet([Capability.Browse]),
  browse: async () => {
    throw new QueryError('operator does not exist: uuid ~~* unknown');
  },
  count: async () => 0,
};

test('a throwing adapter surfaces as an err Result, not a rejection', async () => {
  const res = await browseTable(failing, { name: 't', kind: 'table' }, { page: firstPage(10) });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error.message).toContain('operator does not exist');
});
