/**
 * Unit tests for the pure tree projection — grouping objects into categories,
 * fold behaviour, and the initial-cursor helpers. No Ink, no store.
 */

import { test, expect } from 'bun:test';
import {
  buildTree,
  firstCategoryKind,
  firstObjectIndex,
  shortTag,
  type ConnRoot,
} from './tree.ts';
import type { ObjectRef } from '../../domain/datasource/schema.ts';

const root: ConnRoot = { name: 'db', tag: 'PG', connected: true };
const objects: ObjectRef[] = [
  { name: 'users', kind: 'table' },
  { name: 'orders', kind: 'table' },
  { name: 'active_users', kind: 'view' },
];

test('groups objects into categories in canonical order, present-only', () => {
  const rows = buildTree({
    root,
    objects,
    rootExpanded: true,
    expandedCats: new Set(['table', 'view']),
  });
  // connection, Tables, users, orders, Views, active_users
  expect(rows.map((r) => r.type)).toEqual([
    'connection',
    'category',
    'object',
    'object',
    'category',
    'object',
  ]);
  const tables = rows[1]!;
  expect(tables.type).toBe('category');
  if (tables.type === 'category') {
    expect(tables.label).toBe('Tables');
    expect(tables.count).toBe(2);
  }
});

test('a collapsed category hides its objects; a collapsed root hides all', () => {
  const collapsedCat = buildTree({
    root,
    objects,
    rootExpanded: true,
    expandedCats: new Set(['view']), // tables collapsed
  });
  expect(collapsedCat.some((r) => r.type === 'object' && r.label === 'users')).toBe(
    false,
  );
  expect(collapsedCat.some((r) => r.type === 'object' && r.label === 'active_users')).toBe(
    true,
  );

  const collapsedRoot = buildTree({
    root,
    objects,
    rootExpanded: false,
    expandedCats: new Set(['table', 'view']),
  });
  expect(collapsedRoot).toHaveLength(1); // just the connection row
});

test('initial-cursor helpers point at the first present category and object', () => {
  expect(firstCategoryKind(objects)).toBe('table');
  expect(firstCategoryKind([{ name: 'c', kind: 'collection' }])).toBe('collection');
  expect(firstCategoryKind([])).toBeNull();

  const rows = buildTree({
    root,
    objects,
    rootExpanded: true,
    expandedCats: new Set(['table']),
  });
  expect(firstObjectIndex(rows)).toBe(2); // connection(0), Tables(1), users(2)
});

test('shortTag maps known dialects and passes others through', () => {
  expect(shortTag('PostgreSQL')).toBe('PG');
  expect(shortTag('MongoDB')).toBe('Mongo');
  expect(shortTag('Snowflake')).toBe('Snowflake');
});
