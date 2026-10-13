import {
  setTimeout as realTimeout,
  clearTimeout as clearRealTimeout,
} from 'node:timers';

import { getTestRuntime } from '@soundor/test-runtime';
import { vi } from 'vitest';

export type UpdateWrapper = (
  action: () => unknown | Promise<unknown>,
) => Promise<void>;
export const direct: UpdateWrapper = async (action) => {
  await action();
};
export interface WaitOptions {
  timeout?: number;
  interval?: number;
}
export async function waitFor<T>(
  callback: () => T | Promise<T>,
  options: WaitOptions = {},
  wrap: UpdateWrapper = direct,
): Promise<T> {
  const timeout = options.timeout ?? 1000,
    interval = options.interval ?? 20;
  if (
    !Number.isFinite(timeout) ||
    timeout < 0 ||
    !Number.isFinite(interval) ||
    interval <= 0
  )
    throw new RangeError(
      'waitFor requires a nonnegative timeout and positive interval',
    );
  let elapsed = 0,
    last: unknown;
  const failure = () =>
    new Error(
      `Timed out after ${timeout}ms: ${last instanceof Error ? last.message : String(last ?? 'callback did not settle')}`,
      { cause: last },
    );
  let timer: ReturnType<typeof realTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = realTimeout(() => reject(failure()), timeout);
  });
  try {
    for (;;) {
      // Flush React before evaluating assertions; a stuck async callback must not hold an act scope open.
      await wrap(() => {});
      try {
        return await Promise.race([Promise.resolve().then(callback), deadline]);
      } catch (error) {
        last = error;
      }
      if (elapsed >= timeout) throw failure();
      const step = Math.min(interval, timeout - elapsed);
      await Promise.race([
        vi.isFakeTimers()
          ? wrap(async () => {
              await vi.advanceTimersByTimeAsync(step);
            })
          : new Promise<void>((resolve) => setTimeout(resolve, step)),
        deadline,
      ]);
      elapsed += step;
    }
  } finally {
    if (timer !== undefined) clearRealTimeout(timer);
  }
}
export async function advanceTime(
  milliseconds: number,
  wrap: UpdateWrapper = direct,
): Promise<void> {
  if (!Number.isFinite(milliseconds) || milliseconds < 0)
    throw new RangeError(
      'advanceTime requires finite nonnegative milliseconds',
    );
  const runtime = getTestRuntime();
  const end = runtime.clock.now + milliseconds;
  // Give React a commit opportunity between native frames, including effects that start animations.
  do {
    const step = Math.min(1000 / 60, Math.max(0, end - runtime.clock.now));
    await wrap(async () => {
      runtime.advanceTime(step);
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(step);
      await Promise.resolve();
    });
  } while (runtime.clock.now < end);
}
