/**
 * Outbound port: where a connection's secret (password) lives, keyed by profile
 * id. Kept separate from ConnectionRepository so config stays shareable while
 * secrets are isolated. The default adapter is a 0600 file; an OS-keychain
 * adapter can replace it without touching anything above this port. (DIP)
 */

export interface SecretStore {
  get(profileId: string): Promise<string | null>;
  set(profileId: string, secret: string): Promise<void>;
  delete(profileId: string): Promise<void>;
}
