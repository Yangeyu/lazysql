/**
 * useMouse — parse SGR mouse-press events and report them as {x, y} clicks.
 *
 * It subscribes to Ink's OWN input channel (the `internal_eventEmitter` exposed
 * by useStdin) rather than attaching a `data` listener to stdin: stdin is in
 * `readable`/`read()` mode for Ink, and adding a `data` listener would flip it
 * to flowing mode and starve Ink of input. Sharing the channel keeps a single
 * reader. Terminal mouse reporting is enabled/disabled by the composition root
 * (main.tsx) alongside the alternate screen, so this hook only decodes.
 *
 * The latest handler is held in a ref so the subscription is set up once and
 * never churns on re-render.
 */

import { useEffect, useRef } from 'react';
import { useStdin } from 'ink';

export interface MouseClick {
  readonly x: number;
  readonly y: number;
  readonly button: number;
}

// SGR mouse: ESC [ < button ; x ; y (M=press, m=release). 1-based coordinates.
const SGR_MOUSE = /\[<(\d+);(\d+);(\d+)([Mm])/g;

export const useMouse = (onClick: (event: MouseClick) => void): void => {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { internal_eventEmitter } = useStdin() as unknown as {
    internal_eventEmitter?: {
      on: (e: 'input', fn: (data: string) => void) => void;
      removeListener: (e: 'input', fn: (data: string) => void) => void;
    };
  };

  const handler = useRef(onClick);
  handler.current = onClick;

  useEffect(() => {
    const emitter = internal_eventEmitter;
    if (!emitter) return;
    const onData = (data: string): void => {
      const s = String(data);
      SGR_MOUSE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SGR_MOUSE.exec(s)) !== null) {
        const button = Number(m[1]);
        if (m[4] !== 'M' || button >= 64) continue; // press only, ignore wheel
        handler.current({ button, x: Number(m[2]) - 1, y: Number(m[3]) - 1 });
      }
    };
    emitter.on('input', onData);
    return () => emitter.removeListener('input', onData);
  }, [internal_eventEmitter]);
};
