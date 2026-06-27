/**
 * Unit tests for the pure tree projection — multiple connection roots, grouping
 * objects into categories, fold behaviour, and the initial-cursor helpers. No
 * renderer, no store.
 */

import { test, expect } from 'bun:test';
import {
  buildTree,
  firstCategoryKind,
  firstObjectIndex,
  firstSchemaKey,
  groupsBySchema,
  schemaKey,
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

// ── schema tier (groupBySchema) ──────────────────────────────────────────────

const pgObjects: ObjectRef[] = [
  { name: 'users', kind: 'table', namespace: 'public' },
  { name: 'orders', kind: 'table', namespace: 'public' },
  { name: 'audit', kind: 'table', namespace: 'drizzle' },
  { name: 'v_active', kind: 'view', namespace: 'public' },
];

test('groupBySchema splits a category into a schema tier; objects nest deeper', () => {
  const rows = buildTree({
    connections: [active],
    objects: pgObjects,
    rootExpanded: true,
    expandedCats: new Set(['table']),
    groupBySchema: true,
    expandedSchemas: new Set([schemaKey('table', 'public')]),
  });
  // db, Tables, [public], users, orders, [drizzle](collapsed), Views(collapsed)
  expect(rows.map((r) => r.type)).toEqual([
    'connection',
    'category',
    'schema',
    'object',
    'object',
    'schema',
    'category',
  ]);
  const publicSchema = rows[2]!;
  expect(publicSchema.type).toBe('schema');
  if (publicSchema.type === 'schema') {
    expect(publicSchema.label).toBe('public');
    expect(publicSchema.count).toBe(2); // users, orders — not the drizzle table
  }
  // depth deepens under the tier: category 1 < schema 2 < object 3
  expect(rows[1]!.depth).toBe(1);
  expect(rows[2]!.depth).toBe(2);
  expect(rows[3]!.depth).toBe(3);
});

test('a collapsed schema hides its objects', () => {
  const rows = buildTree({
    connections: [active],
    objects: pgObjects,
    rootExpanded: true,
    expandedCats: new Set(['table']),
    groupBySchema: true,
    expandedSchemas: new Set(), // both schemas collapsed
  });
  expect(rows.some((r) => r.type === 'object')).toBe(false);
  expect(rows.filter((r) => r.type === 'schema')).toHaveLength(2); // public, drizzle
});

test('groupBySchema off (or no namespace) lists objects flat under the category', () => {
  // Off: the same PG objects stay flat (object depth 2, no schema rows).
  const flat = buildTree({
    connections: [active],
    objects: pgObjects,
    rootExpanded: true,
    expandedCats: new Set(['table']),
  });
  expect(flat.some((r) => r.type === 'schema')).toBe(false);
  expect(flat.find((r) => r.type === 'object')!.depth).toBe(2);

  // On but objects carry no namespace (SQLite): still flat — the tier needs data.
  const noNs = buildTree({
    connections: [active],
    objects, // the namespace-free fixture
    rootExpanded: true,
    expandedCats: new Set(['table']),
    groupBySchema: true,
  });
  expect(noNs.some((r) => r.type === 'schema')).toBe(false);
});

test('groupsBySchema gates on the driver: only Postgres grows the tier', () => {
  expect(groupsBySchema('postgres')).toBe(true);
  expect(groupsBySchema('mysql')).toBe(false);
  expect(groupsBySchema('sqlite')).toBe(false);
  expect(groupsBySchema('mongodb')).toBe(false);
});

test('firstSchemaKey points at the first namespace of a category, else null', () => {
  expect(firstSchemaKey(pgObjects, 'table')).toBe(schemaKey('table', 'public'));
  expect(firstSchemaKey(objects, 'table')).toBeNull(); // no namespace
});

test('shortTag maps known dialects and passes others through', () => {
  expect(shortTag('PostgreSQL')).toBe('PG');
  expect(shortTag('MongoDB')).toBe('Mongo');
  expect(shortTag('Snowflake')).toBe('Snowflake');
});
