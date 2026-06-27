/**
 * Pure rules of the object-detail model: which sections a kind exposes, and
 * reading the columns back out. No IO, no adapter.
 */

import { test, expect } from 'bun:test';
import { sectionsFor, columnsOf, type ObjectSchema } from '../schema.ts';

test('sectionsFor: a view has columns + source, a table only columns', () => {
  expect(sectionsFor('table')).toEqual(['columns']);
  expect(sectionsFor('view')).toEqual(['columns', 'source']);
  expect(sectionsFor('collection')).toEqual(['columns']);
});

test('sectionsFor: source-only kinds expose just their definition', () => {
  expect(sectionsFor('index')).toEqual(['source']);
  expect(sectionsFor('trigger')).toEqual(['source']);
  expect(sectionsFor('sequence')).toEqual(['source']);
  expect(sectionsFor('procedure')).toEqual(['source']);
});

test('columnsOf: returns the columns section, or [] when there is none', () => {
  const withCols: ObjectSchema = {
    ref: { name: 't', kind: 'table' },
    detail: [{ kind: 'columns', columns: [{ name: 'id', dataType: 'INTEGER', nullable: false, isPrimaryKey: true }] }],
  };
  expect(columnsOf(withCols).map((c) => c.name)).toEqual(['id']);

  const sourceOnly: ObjectSchema = {
    ref: { name: 'idx', kind: 'index' },
    detail: [{ kind: 'source', text: 'CREATE INDEX …' }],
  };
  expect(columnsOf(sourceOnly)).toEqual([]);
});
