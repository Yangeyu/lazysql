/**
 * Unit tests for the pure tree projection — multiple connection roots, grouping
 * objects into categories, fold behaviour, and the initial-cursor helpers. No
 * Ink, no store.
 */

import { test, expect } from 'bun:test';
import {
  buildTree,
  firstCategoryKind,
  firstObjectIndex,
  shortTag,
  type ConnNode,
} from '../tree.ts';
import type { ObjectRef } from '../../../domain/datasource/schema.ts';

const active: ConnNode = { id: 'db', name: 'db', tag: 'PG', active: true };
const other: ConnNode = { id: 'cache', name: 'cache', tag: 'Redis', active: false };
const objects: ObjectRef[] = [
  { name: 'users', kind: 'table' },
  { name: 'orders', kind: 'table' },
  { name: 'active_users', kind: 'view' },
];

test('groups the active connection objects into categories; inactive roots stay leaves', () => {
  const rows = buildTree({
    connections: [active, other],
    objects,
    rootExpanded: true,
    expandedCats: new Set(['table', 'view']),
  });
  // db, Tables, users, orders, Views, active_users, cache
  expect(rows.map((r) => r.type)).toEqual([
    'connection',
    'category',
    'object',
    'object',
    'category',
    'object',
    'connection',
  ]);
  const tables = rows[1]!;
  expect(tables.type).toBe('category');
  if (tables.type === 'category') {
    expect(tables.label).toBe('Tables');
    expect(tables.count).toBe(2);
  }
  // the inactive connection never carries a schema subtree
  expect(rows[rows.length - 1]!.type).toBe('connection');
});

test('a collapsed category hides its objects; a collapsed root hides all', () => {
  const collapsedCat = buildTree({
    connections: [active],
    objects,
    rootExpanded: true,
    expandedCats: new Set(['view']), // tables collapsed
  });
  expect(
    collapsedCat.some((r) => r.type === 'object' && r.label === 'users'),
  ).toBe(false);
  expect(
    collapsedCat.some((r) => r.type === 'object' && r.label === 'active_users'),
  ).toBe(true);

  const collapsedRoot = buildTree({
    connections: [active],
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
    connections: [active],
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
