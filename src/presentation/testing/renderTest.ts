/**
 * renderTest — the one test harness for driving the real OpenTUI renderer in
 * `bun test`. It wraps `@opentui/react`'s `testRender` (a mock terminal with
 * programmable input + frame capture) into the small surface the suites use:
 * mount a tree, press/type/click, read the rendered char frame, wait for it to
 * settle, tear down. One harness, no shims: `frame()` reads the captured chars,
 * `press`/`type` drive the mock keyboard, `click` the mock mouse, `cleanup()`
 * tears the renderer down.
 */

import type { ReactNode } from 'react';
import { testRender } from '@opentui/react/test-utils';

/** Keyboard modifiers OpenTUI's mock accepts. */
export interface Mods {
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export interface TestHandle {
  /** The current rendered frame as plain text (no ANSI). */
  frame: () => string;
  /** Press one key. `key` is a character ('j', ':') or a named code
   *  ('RETURN', 'ARROW_DOWN', 'ESCAPE', 'TAB', 'BACKSPACE', …). */
  press: (key: string, mods?: Mods) => void;
  /** Type a run of text (each character as its own key event). */
  type: (text: string) => Promise<void>;
  enter: () => void;
  esc: () => void;
  tab: () => void;
  arrow: (dir: 'up' | 'down' | 'left' | 'right') => void;
  /** ⌃<key>, e.g. ctrl('c'). */
  ctrl: (key: string) => void;
  /** Left-click at a 0-based cell coordinate. */
  click: (x: number, y: number) => Promise<void>;
  /** Left-drag from one cell to another (press · move · release) — for text
   *  selection. */
  drag: (x1: number, y1: number, x2: number, y2: number) => Promise<void>;
  /** Wheel/trackpad scroll at a cell coordinate, in a direction. */
  scroll: (
    x: number,
    y: number,
    direction: 'up' | 'down' | 'left' | 'right',
  ) => Promise<void>;
  /** The renderer's current selected text (aggregated across selectables). */
  selectedText: () => string;
  resize: (width: number, height: number) => void;
  /** Drain pending renders. */
  flush: () => Promise<void>;
  /** Advance the render loop until the frame satisfies `pred` (or it gives up). */
  waitForFrame: (pred: (frame: string) => boolean) => Promise<string>;
  /**
   * Poll the frame until `pred` holds, flushing renders and yielding wall-clock
   * between checks so async store work (DB connect, query) can resolve. Throws on
   * timeout — the robust wait for integration steps that cross a Promise.
   */
  until: (pred: (frame: string) => boolean, timeoutMs?: number) => Promise<string>;
  /** Restore the terminal + free resources. */
  cleanup: () => void;
}

export const renderTest = async (
  ui: ReactNode,
  opts?: { width?: number; height?: number },
): Promise<TestHandle> => {
  const t = await testRender(ui, {
    width: opts?.width ?? 120,
    height: opts?.height ?? 30,
  });
  return {
    frame: () => t.captureCharFrame(),
    press: (key, mods) => t.mockInput.pressKey(key, mods),
    type: (text) => t.mockInput.typeText(text),
    enter: () => t.mockInput.pressEnter(),
    esc: () => t.mockInput.pressEscape(),
    tab: () => t.mockInput.pressTab(),
    arrow: (dir) => t.mockInput.pressArrow(dir),
    ctrl: (key) => t.mockInput.pressKey(key, { ctrl: true }),
    click: (x, y) => t.mockMouse.click(x, y),
    drag: (x1, y1, x2, y2) => t.mockMouse.drag(x1, y1, x2, y2),
    scroll: (x, y, direction) => t.mockMouse.scroll(x, y, direction),
    selectedText: () => t.renderer.getSelection()?.getSelectedText() ?? '',
    resize: (width, height) => t.resize(width, height),
    flush: () => t.flush(),
    waitForFrame: (pred) => t.waitForFrame(pred),
    until: async (pred, timeoutMs = 2000) => {
      const start = Date.now();
      for (;;) {
        await t.flush();
        const frame = t.captureCharFrame();
        if (pred(frame)) return frame;
        if (Date.now() - start > timeoutMs) {
          throw new Error('renderTest.until: timed out waiting for the frame');
        }
        await Bun.sleep(10);
      }
    },
    cleanup: () => t.renderer.destroy(),
  };
};
