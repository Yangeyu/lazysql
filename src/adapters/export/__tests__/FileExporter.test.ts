import { test, expect } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileExporter } from '../FileExporter.ts';

const withTmpDir = async (fn: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'lazysql-export-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test('writes the streamed chunks and leaves only the final file (temp renamed away)', async () => {
  await withTmpDir(async (dir) => {
    const path = join(dir, 'out.csv');
    const opened = await new FileExporter().open({ path });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    await opened.value.write('id,label\n');
    await opened.value.write('1,a\n');
    const closed = await opened.value.close();

    expect(closed.ok).toBe(true);
    expect(await readFile(path, 'utf8')).toBe('id,label\n1,a\n');
    expect(await readdir(dir)).toEqual(['out.csv']); // no leftover .tmp
  });
});

test('abort discards the partial file — no target, no temp', async () => {
  await withTmpDir(async (dir) => {
    const path = join(dir, 'out.csv');
    const opened = await new FileExporter().open({ path });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    await opened.value.write('partial');
    await opened.value.abort();

    expect(await readdir(dir)).toEqual([]); // nothing written through
  });
});

test('reports the resolved absolute path for a relative target', async () => {
  await withTmpDir(async () => {
    const opened = await new FileExporter().open({ path: 'rel.csv' });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // Resolved against CWD → absolute; clean up whatever it created.
    expect(opened.value.path.startsWith('/')).toBe(true);
    await opened.value.abort();
  });
});
