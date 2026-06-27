/**
 * Config path resolution. Honors LAZYSQL_CONFIG_DIR (handy for tests), then
 * XDG_CONFIG_HOME, then ~/.config — landing at ~/.config/lazysql by default.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

export const configDir = (): string => {
  if (process.env.LAZYSQL_CONFIG_DIR) return process.env.LAZYSQL_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'lazysql');
};

export const connectionsFile = (): string => join(configDir(), 'connections.yml');

export const secretsFile = (): string => join(configDir(), 'secrets.json');

/** Application settings (non-secret), e.g. the NL→SQL provider. */
export const configFile = (): string => join(configDir(), 'config.yml');
