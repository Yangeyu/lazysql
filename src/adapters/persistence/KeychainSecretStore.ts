/**
 * SecretStore backed by the macOS Keychain via the `security` CLI — a second
 * implementation of the same port, proving secrets can move off-disk with zero
 * changes above the port (the whole point of ADR 0002/0003-style isolation).
 * No native module: it shells out, keeping single-binary distribution simple
 * (ADR 0001). Linux (libsecret) / Windows (wincred) backends are follow-ups.
 *
 * Selected via LAZYSQL_SECRETS=keychain; the default stays FileSecretStore.
 */

import type { SecretStore } from '../../application/ports/SecretStore.ts';

const SERVICE = 'lazysql';

const run = async (
  args: string[],
): Promise<{ code: number; stdout: string }> => {
  const proc = Bun.spawn(['security', ...args], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
};

export class KeychainSecretStore implements SecretStore {
  /** Optional keychain file (used by tests); defaults to the login keychain. */
  constructor(private readonly keychain?: string) {}

  static isSupported(): boolean {
    return process.platform === 'darwin';
  }

  private kc(): string[] {
    return this.keychain ? [this.keychain] : [];
  }

  async get(profileId: string): Promise<string | null> {
    const { code, stdout } = await run([
      'find-generic-password',
      '-s',
      SERVICE,
      '-a',
      profileId,
      '-w',
      ...this.kc(),
    ]);
    if (code !== 0) return null; // not found
    return stdout.replace(/\n$/, '');
  }

  async set(profileId: string, secret: string): Promise<void> {
    // -U updates the item if it already exists.
    await run([
      'add-generic-password',
      '-U',
      '-s',
      SERVICE,
      '-a',
      profileId,
      '-w',
      secret,
      ...this.kc(),
    ]);
  }

  async delete(profileId: string): Promise<void> {
    await run([
      'delete-generic-password',
      '-s',
      SERVICE,
      '-a',
      profileId,
      ...this.kc(),
    ]);
  }
}
