/**
 * FileExporter — an Exporter backed by the filesystem. It streams to a temp file
 * and renames onto the target on close, so a cancelled or failed export never
 * leaves a half-written file. Relative targets resolve against the process CWD
 * (where the user launched lazysql), so `widget.csv` lands where they'd expect.
 * Every method surfaces IO failure as a Result — the boundary never throws.
 */

import { mkdir, open, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { ok, err, type Result } from '../../shared/Result.ts';
import { ExportError } from '../../domain/errors/errors.ts';
import type { Exporter, ExportSink, ExportTarget } from '../../application/ports/Exporter.ts';

class FileSink implements ExportSink {
  constructor(
    readonly path: string,
    private readonly tmp: string,
    private readonly handle: FileHandle,
  ) {}

  async write(chunk: string): Promise<Result<void, ExportError>> {
    try {
      await this.handle.write(chunk);
      return ok(undefined);
    } catch (e) {
      return err(new ExportError(`export write failed for ${this.path}`, e));
    }
  }

  async close(): Promise<Result<void, ExportError>> {
    try {
      await this.handle.close();
      await rename(this.tmp, this.path);
      return ok(undefined);
    } catch (e) {
      await this.discard();
      return err(new ExportError(`could not finalize ${this.path}`, e));
    }
  }

  async abort(): Promise<void> {
    await this.handle.close().catch(() => {});
    await this.discard();
  }

  private async discard(): Promise<void> {
    await unlink(this.tmp).catch(() => {});
  }
}

export class FileExporter implements Exporter {
  async open(target: ExportTarget): Promise<Result<ExportSink, ExportError>> {
    const path = isAbsolute(target.path) ? target.path : resolve(process.cwd(), target.path);
    const tmp = `${path}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      const handle = await open(tmp, 'w');
      return ok(new FileSink(path, tmp, handle));
    } catch (e) {
      return err(new ExportError(`cannot open ${path} for export`, e));
    }
  }
}
