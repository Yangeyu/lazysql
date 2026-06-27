/**
 * JsonQueryHistoryStore: per-connection history round-trips through a JSON file,
 * a missing or corrupt file reads as empty, and connections stay isolated. Uses a
 * temp file — no global config is touched.
 */

import { test, expect, afterAll } from 'bun:test';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonQueryHistoryStore } from '../JsonQueryHistoryStore.ts';

const file = join(tmpdir(), `lazysql-hist-${process.pid}.json`);
afterAll(async () => rm(file, { force: true }));

test('missing file reads as empty', async () => {
  const store = new JsonQueryHistoryStore(file);
  expect(await store.load('any')).toEqual([]);
});

test('saves and reloads a connection’s history, keeping connections isolated', async () => {
  const store = new JsonQueryHistoryStore(file);
  await store.save('pg', ['SELECT 1', 'SELECT 2']);
  await store.save('mysql', ['SHOW TABLES']);

  expect(await store.load('pg')).toEqual(['SELECT 1', 'SELECT 2']);
  expect(await store.load('mysql')).toEqual(['SHOW TABLES']);
  expect(await store.load('unknown')).toEqual([]);

  // A fresh instance reads the same file — it persisted.
  expect(await new JsonQueryHistoryStore(file).load('pg')).toEqual(['SELECT 1', 'SELECT 2']);
});

test('a corrupt file reads as empty rather than throwing', async () => {
  await writeFile(file, 'not json{', 'utf8');
  expect(await new JsonQueryHistoryStore(file).load('pg')).toEqual([]);
});
