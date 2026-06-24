/**
 * Outbound port: builds a DataSource from a profile. This keeps the application
 * layer from importing the adapter registry directly — the composition root
 * injects the concrete factory (createDataSource). (DIP)
 */

import type { ConnectionProfile } from '../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../domain/datasource/DataSource.ts';
import type { ConnectionError } from '../../domain/errors/errors.ts';
import type { Result } from '../../shared/Result.ts';

export type DataSourceFactory = (
  profile: ConnectionProfile,
) => Result<DataSource, ConnectionError>;
