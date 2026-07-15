/**
 * Use cases for single-row edits. Thin orchestration over the RowEditable
 * capability that returns a typed Result — turning the adapter's safety guard
 * (rollback unless exactly one row changes) into a value the UI can surface.
 */

import {
  asRowEditable,
  type DataSource,
} from '../../domain/datasource/DataSource.ts';
import type { ObjectRef } from '../../domain/datasource/schema.ts';
import type {
  RowKey,
  RowPatch,
  EditResult,
} from '../../domain/datasource/edit.ts';
import { err, type Result } from '../../shared/Result.ts';
import {
  UnsupportedCapabilityError,
  attempt,
  type DataSourceError,
} from '../../domain/errors/errors.ts';

export const updateRow = async (
  source: DataSource,
  ref: ObjectRef,
  key: RowKey,
  patch: RowPatch,
): Promise<Result<EditResult, DataSourceError>> => {
  const editable = asRowEditable(source);
  if (!editable) {
    return err(new UnsupportedCapabilityError(`source cannot edit rows`));
  }
  return attempt(() => editable.update(ref, key, patch));
};

export const deleteRow = async (
  source: DataSource,
  ref: ObjectRef,
  key: RowKey,
): Promise<Result<EditResult, DataSourceError>> => {
  const editable = asRowEditable(source);
  if (!editable) {
    return err(new UnsupportedCapabilityError(`source cannot edit rows`));
  }
  return attempt(() => editable.delete(ref, key));
};
