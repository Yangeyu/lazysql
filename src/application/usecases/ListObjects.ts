/**
 * Use case: list the browsable objects (tables/collections/...) of a source.
 *
 * Requires the SchemaIntrospect capability; returns a typed failure if the
 * source doesn't support it, so the UI can degrade gracefully instead of the
 * adapter throwing across the boundary.
 */

import {
  asIntrospectable,
  type DataSource,
} from '../../domain/datasource/DataSource.ts';
import type { ObjectRef } from '../../domain/datasource/schema.ts';
import { ok, err, type Result } from '../../shared/Result.ts';
import { UnsupportedCapabilityError } from '../../domain/errors/errors.ts';

export const listObjects = async (
  source: DataSource,
): Promise<Result<ObjectRef[], UnsupportedCapabilityError>> => {
  const introspectable = asIntrospectable(source);
  if (!introspectable) {
    return err(
      new UnsupportedCapabilityError(
        `source "${source.id}" cannot introspect schema`,
      ),
    );
  }
  const snapshot = await introspectable.introspect();
  return ok(snapshot.objects);
};
