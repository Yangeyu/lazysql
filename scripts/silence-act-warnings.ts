/**
 * Test-only console filter — loaded via bunfig `[test] preload`.
 *
 * @opentui/react's test renderer (testRender) wraps only the initial render and
 * the unmount in act(); every mock interaction (pressKey, scroll, …) fires
 * OUTSIDE act, so React floods stderr with one warning — ~2380 lines per full
 * `bun test` run — drowning the real failures. Wrapping our own renderTest
 * harness in act() instead is NOT viable: it changes OpenTUI's frame batching
 * and breaks timing-sensitive suites (until() times out, frame assertions
 * shift). The harness already settles renders via until()/flush(), so this
 * warning is pure noise here, not a missed-update signal.
 *
 * Drop ONLY that one message; every other console.error passes through. Scoped
 * to [test] preload, so dev/prod runs are untouched.
 */

const original = console.error.bind(console);

console.error = (...args: unknown[]): void => {
  const first = args[0];
  if (typeof first === 'string' && first.includes('not wrapped in act')) return;
  original(...args);
};
