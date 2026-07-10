/**
 * SSH local port forward over the system `ssh` binary — how a profile's `ssh`
 * block reaches a database behind a bastion. Zero dependencies by design: the
 * user's ~/.ssh/config, keys and agent all apply (`host` may be a config
 * alias). BatchMode is forced — the TUI owns the terminal, so an interactive
 * SSH password/passphrase prompt can never be answered; key/agent auth only.
 *
 * `SshTunnel.open` resolves once the local forward accepts TCP connections
 * (or fails with ssh's stderr); `close()` tears the process down. The caller
 * owns the lifetime — the registry ties it to the DataSource's disconnect.
 */

import { createServer, connect } from 'node:net';
import type { SshTunnelConfig } from '../../../domain/connection/ConnectionProfile.ts';
import { ConnectionError } from '../../../domain/errors/errors.ts';
import { ok, err, type Result } from '../../../shared/Result.ts';
import { resolveUserPath } from '../../../shared/path.ts';

export interface TunnelTarget {
  readonly host: string;
  readonly port: number;
}

/** How long the forward may take to come up before we kill ssh and fail —
 *  covers ConnectTimeout=10 plus auth/banner time on slow bastions. */
const READY_TIMEOUT_MS = 15_000;

/** ssh argv (sans the binary) for `-L 127.0.0.1:localPort → target` via cfg. */
export const buildSshArgs = (
  cfg: SshTunnelConfig,
  target: TunnelTarget,
  localPort: number,
): string[] => {
  const args = [
    '-N',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=10',
    // A NAT/firewall can silently drop the idle link; keepalives make ssh
    // notice and exit (~90s) instead of holding a dead forward open forever.
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-L', `127.0.0.1:${localPort}:${target.host}:${target.port}`,
  ];
  if (cfg.port !== undefined) args.push('-p', String(cfg.port));
  if (cfg.keyFile) args.push('-i', resolveUserPath(cfg.keyFile));
  args.push(cfg.user ? `${cfg.user}@${cfg.host}` : cfg.host);
  return args;
};

/** An OS-assigned free port. Racy by nature (released before ssh binds it),
 *  which is the standard trade-off — collisions are practically nonexistent. */
const freeLocalPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });

const canConnect = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const sock = connect({ host: '127.0.0.1', port });
    sock.once('connect', () => {
      sock.end();
      resolve(true);
    });
    sock.once('error', () => resolve(false));
  });

export class SshTunnel {
  private constructor(
    readonly localPort: number,
    private readonly proc: ReturnType<typeof Bun.spawn>,
    private readonly onProcessExit: () => void,
  ) {}

  static async open(
    cfg: SshTunnelConfig,
    target: TunnelTarget,
  ): Promise<Result<SshTunnel, ConnectionError>> {
    const localPort = await freeLocalPort().catch(() => null);
    if (localPort === null) {
      return err(new ConnectionError('ssh tunnel: could not allocate a local port'));
    }

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(['ssh', ...buildSshArgs(cfg, target, localPort)], {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
      });
    } catch {
      return err(new ConnectionError('ssh tunnel: `ssh` not found on PATH'));
    }

    // ssh is a child PROCESS — unlike a driver's sockets it survives our exit.
    // The app's quit path fire-and-forgets disconnect() and exits before the
    // async teardown reaches close(), so an exit hook (which runs
    // synchronously on process.exit) is what actually prevents orphans.
    const onProcessExit = () => proc.kill();
    process.on('exit', onProcessExit);

    // Resolves when the process closes; started now so nothing is lost.
    const stderrText = new Response(proc.stderr as ReadableStream).text().catch(() => '');
    let exited = false;
    void proc.exited.then(() => {
      exited = true;
    });

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!exited && Date.now() < deadline) {
      if (await canConnect(localPort)) {
        return ok(new SshTunnel(localPort, proc, onProcessExit));
      }
      await Bun.sleep(150);
    }

    if (!exited) proc.kill();
    process.off('exit', onProcessExit);
    // The last stderr line is ssh's verdict (auth failure, unknown host, …).
    const detail = (await stderrText).trim().split('\n').filter(Boolean).pop() ?? '';
    const outcome = exited ? 'ssh exited' : `not ready after ${READY_TIMEOUT_MS / 1000}s`;
    return err(
      new ConnectionError(`ssh tunnel: ${outcome}${detail ? ` — ${detail}` : ''}`),
    );
  }

  close(): void {
    process.off('exit', this.onProcessExit);
    this.proc.kill();
  }
}
