import { test, expect } from 'bun:test';
import {
  wrapFrame,
  enableSynchronizedOutput,
  SYNC_BEGIN,
  SYNC_END,
} from './synchronizedOutput.ts';

test('wrapFrame brackets a frame in the 2026 begin/end markers', () => {
  expect(wrapFrame('HELLO')).toBe(`${SYNC_BEGIN}HELLO${SYNC_END}`);
  // Self-closing: the frame both opens and closes 2026, so it is never left on.
  expect(wrapFrame('x').startsWith(SYNC_BEGIN)).toBe(true);
  expect(wrapFrame('x').endsWith(SYNC_END)).toBe(true);
});

test('enableSynchronizedOutput wraps string frames and restores exactly', () => {
  const writes: unknown[] = [];
  const fake = {
    write: (chunk: unknown) => {
      writes.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WriteStream;

  const restore = enableSynchronizedOutput(fake);
  fake.write('FRAME');
  expect(writes).toEqual([`${SYNC_BEGIN}FRAME${SYNC_END}`]);

  // Raw byte buffers (non-string) pass through untouched — never double-wrapped.
  const bytes = new Uint8Array([1, 2, 3]);
  fake.write(bytes);
  expect(writes[1]).toBe(bytes);

  restore();
  fake.write('RAW');
  expect(writes[2]).toBe('RAW'); // restored: no wrapping after restore
});

test('enableSynchronizedOutput forwards the return value and extra args', () => {
  const seen: unknown[][] = [];
  const fake = {
    write: (...args: unknown[]) => {
      seen.push(args);
      return false; // backpressure signal must propagate
    },
  } as unknown as NodeJS.WriteStream;

  const restore = enableSynchronizedOutput(fake);
  const cb = () => {};
  const ret = (fake.write as (c: string, e: string, cb: () => void) => boolean)(
    'F',
    'utf8',
    cb,
  );
  expect(ret).toBe(false);
  expect(seen[0]).toEqual([`${SYNC_BEGIN}F${SYNC_END}`, 'utf8', cb]);
  restore();
});
