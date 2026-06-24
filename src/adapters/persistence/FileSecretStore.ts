/**
 * SecretStore backed by a 0600 JSON file (~/.config/lazysql/secrets.json),
 * keyed by profile id. Permissions are enforced on every write so the password
 * file stays readable only by its owner. Swappable for an OS-keychain adapter
 * via the SecretStore port without changing anything above it.
 */

import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { secretsFile } from './paths.ts';
import type { SecretStore } from '../../application/ports/SecretStore.ts';

type Secrets = Record<string, string>;

const isNotFound = (e: unknown): boolean =>
  (e as { code?: string }).code === 'ENOENT';

export class FileSecretStore implements SecretStore {
  constructor(private readonly file: string = secretsFile()) {}

  async get(profileId: string): Promise<string | null> {
    return (await this.read())[profileId] ?? null;
  }

  async set(profileId: string, secret: string): Promise<void> {
    const secrets = await this.read();
    secrets[profileId] = secret;
    await this.write(secrets);
  }

  async delete(profileId: string): Promise<void> {
    const secrets = await this.read();
    delete secrets[profileId];
    await this.write(secrets);
  }

  private async read(): Promise<Secrets> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Secrets;
    } catch (e) {
      if (isNotFound(e)) return {};
      throw e;
    }
  }

  private async write(secrets: Secrets): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    await chmod(this.file, 0o600); // enforce perms even if the file pre-existed
  }
}
