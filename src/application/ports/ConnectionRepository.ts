/**
 * Outbound port: where connection profiles are persisted. The application
 * depends on this interface; a concrete adapter (YAML file, later maybe a DB)
 * implements it. Secrets never pass through here — see SecretStore. (DIP)
 */

import type { ConnectionProfile } from '../../domain/connection/ConnectionProfile.ts';

export interface ConnectionRepository {
  list(): Promise<ConnectionProfile[]>;
  get(id: string): Promise<ConnectionProfile | null>;
  save(profile: ConnectionProfile): Promise<void>;
  remove(id: string): Promise<void>;
}
