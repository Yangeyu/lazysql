import { test, expect } from 'bun:test';
import { formatHelp, formatVersion } from '../help.ts';
import { OPTIONS, USAGE } from '../spec.ts';

// The help screen is generated from the spec, so it can never advertise less
// than the parser recognises: assert every option flag + summary is present.
test('formatHelp lists every option from the spec (single source of truth)', () => {
  const help = formatHelp();
  for (const o of OPTIONS) {
    for (const flag of o.flags) expect(help).toContain(flag);
    expect(help).toContain(o.summary);
  }
});

test('formatHelp shows every usage form', () => {
  const help = formatHelp();
  for (const u of USAGE) expect(help).toContain(u.form);
});

test('formatVersion prints the name and version', () => {
  expect(formatVersion('0.1.5')).toBe('lazysql 0.1.5');
});
