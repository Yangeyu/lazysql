/**
 * buildSshArgs — the pure argv assembly for the `-L` forward. The spawn/ready
 * loop needs a live SSH server and is not tested here (same policy as the
 * contract suites: nothing reachable, nothing to assert).
 */

import { test, expect } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildSshArgs } from '../SshTunnel.ts';

const target = { host: 'db.internal', port: 5432 };

const BASE = [
  '-N',
  '-o', 'BatchMode=yes',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ConnectTimeout=10',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3',
  '-L', '127.0.0.1:55001:db.internal:5432',
];

test('minimal config: batch mode + keepalive, forward spec, bare host', () => {
  expect(buildSshArgs({ host: 'bastion' }, target, 55001)).toEqual([
    ...BASE,
    'bastion',
  ]);
});

test('full config: -p, -i (with ~ expanded), user@host', () => {
  const args = buildSshArgs(
    { host: 'bastion', port: 2222, user: 'ops', keyFile: '~/.ssh/id_ed25519' },
    target,
    55001,
  );
  expect(args).toEqual([
    ...BASE,
    '-p', '2222',
    '-i', join(homedir(), '.ssh/id_ed25519'),
    'ops@bastion',
  ]);
});
