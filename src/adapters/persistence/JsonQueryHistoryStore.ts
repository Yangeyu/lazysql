/**
 * QueryHistoryStore backed by a single JSON file
 * (~/.config/lazysql/history.json): a map of connection id → recent statements.
 * Non-secret and human-inspectable, like connections.yml. A missing or corrupt
 * file reads as empty, and writes are best-effort (callers ignore rejections),
 * so editor history never blocks or fails a query.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { historyFile } from './paths.ts';
import type { QueryHistoryStore } from '../../application/ports/QueryHistoryStore.ts';

type HistoryMap = Record<string, string[]>;

const isHistoryMap = (v: unknown): v is HistoryMap =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).every((x) => Array.isArray(x) && x.every((s) => typeof s === 'string'));

export class JsonQueryHistoryStore implements QueryHistoryStore {
  constructor(private readonly file: string = historyFile()) {}

  async load(connectionId: string): Promise<string[]> {
    const map = await this.read();
    return map[connectionId] ?? [];
  }

  async save(connectionId: string, history: readonly string[]): Promise<void> {
    const map = await this.read();
    map[connectionId] = [...history];
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(map, null, 2), 'utf8');
  }

  private async read(): Promise<HistoryMap> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as unknown;
      return isHistoryMap(parsed) ? parsed : {};
    } catch {
      return {}; // missing or corrupt → start fresh
    }
  }
}
