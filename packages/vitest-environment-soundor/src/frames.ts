import type { initializeTestContext } from '@soundor/test-runtime';

const framesPerSecond = 60;

/** Native frames.js snapshots the batch before calling it: cancellation only affects future batches. */
export function createFrames(
  context: ReturnType<typeof initializeTestContext>,
  reportError: (error: unknown) => void,
) {
  let callbacks = new Map<number, (time: number) => void>();
  let nextId = 1;
  let frame: number | undefined;
  const clear = () => {
    if (frame !== undefined) context.runtime.clock.clearTimeout(frame);
    frame = undefined;
    callbacks.clear();
  };
  context.cleanups.add(clear);
  context.listeners.add(() => {
    context.cleanups.add(clear);
  });
  return {
    requestAnimationFrame(callback: (time: number) => void): number {
      if (typeof callback !== 'function')
        throw new TypeError('requestAnimationFrame() expects a function');
      const runtime = context.runtime;
      runtime.assertActive();
      const id = nextId++;
      callbacks.set(id, callback);
      if (frame === undefined) {
        const nextFrame =
          ((Math.floor((runtime.clock.now * framesPerSecond) / 1000 + 1e-9) +
            1) *
            1000) /
          framesPerSecond;
        frame = runtime.clock.setTimeout(() => {
          frame = undefined;
          const due = callbacks;
          callbacks = new Map();
          const time = runtime.clock.now;
          for (const callback of due.values()) {
            try {
              callback(time);
            } catch (error) {
              reportError(error);
            }
          }
        }, nextFrame - runtime.clock.now);
      }
      return id;
    },
    cancelAnimationFrame(id: number) {
      callbacks.delete(id);
      if (callbacks.size === 0 && frame !== undefined) {
        context.runtime.clock.clearTimeout(frame);
        frame = undefined;
      }
    },
  };
}
