/**
 * ConnectionRepository backed by a human-editable YAML file
 * (~/.config/lazysql/connections.yml). Holds profiles only — never secrets — so
 * the file is safe to share, sync, or commit. Missing file reads as empty.
 */

import { parse, stringify } from 'yaml';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { connectionsFile } from './paths.ts';
import type { ConnectionRepository } from '../../application/ports/ConnectionRepository.ts';
import type { ConnectionProfile } from '../../domain/connection/ConnectionProfile.ts';

const isNotFound = (e: unknown): boolean =>
  (e as { code?: string }).code === 'ENOENT';

export class YamlConnectionRepository implements ConnectionRepository {
  constructor(private readonly file: string = connectionsFile()) {}

  async list(): Promise<ConnectionProfile[]> {
    try {
      const text = await readFile(this.file, 'utf8');
      const doc = parse(text) as { connections?: ConnectionProfile[] } | null;
      return doc?.connections ?? [];
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
  }

  async get(id: string): Promise<ConnectionProfile | null> {
    return (await this.list()).find((p) => p.id === id) ?? null;
  }

  async save(profile: ConnectionProfile): Promise<void> {
    const list = await this.list();
    const i = list.findIndex((p) => p.id === profile.id);
    if (i >= 0) list[i] = profile;
    else list.push(profile);
    await this.write(list);
  }

  async remove(id: string): Promise<void> {
    await this.write((await this.list()).filter((p) => p.id !== id));
  }

  private async write(connections: ConnectionProfile[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, stringify({ connections }), 'utf8');
  }
}
