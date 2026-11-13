// The channels of soundor:native in the browser: published by the project's
// runtimes/web code through the generated contract's `channels`, the newest
// value delivered to the plugin UI once a frame, as the JUCE runtime does
// (the engine's tests/native/NativeChannelsTests.cpp checks the same).

import { channels } from 'soundor:native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { channels as publish } from './testing/native';

// Animation frames run when the test says: a hidden page runs none.
let frames: FrameRequestCallback[] = [];
const frame = () => {
  for (const callback of frames.splice(0)) callback(performance.now());
};

const stops: (() => void)[] = [];
function subscribe<T>(
  channel: {
    subscribe(listener: (value: T, sequence: number) => void): () => void;
  },
  listener: (value: T, sequence: number) => void,
) {
  const stop = channel.subscribe(listener);
  stops.push(stop);
  return stop;
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
});

afterEach(() => {
  frame();
  frames = [];
  for (const stop of stops.splice(0)) stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('soundor:native channels', () => {
  it('exports one frozen channel per declaration, without a value at first', () => {
    expect(Object.keys(channels).sort()).toEqual([
      'frames',
      'level',
      'spectrum',
    ]);
    expect(Object.isFrozen(channels)).toBe(true);
    expect(Object.isFrozen(channels.level)).toBe(true);
    expect(channels.spectrum.get()).toBeUndefined();
    expect(() =>
      channels.level.subscribe(null as unknown as () => void),
    ).toThrowError(
      new TypeError('channels.level.subscribe() expects a function, got null'),
    );
  });

  it('delivers the newest value once a frame, with its sequence number', () => {
    const log: string[] = [];
    subscribe(channels.level, (value, sequence) =>
      log.push(`${value}@${sequence}`),
    );
    publish.level.publish(0.25);
    publish.level.publish(0.5);
    publish.level.publish(0.75);
    expect(log).toEqual([]);
    frame();
    expect(log).toEqual(['0.75@3']);
    expect(channels.level.get()).toBe(0.75);
    // Nothing new: no delivery, and no frame asked for.
    frame();
    expect(frames).toEqual([]);
    publish.level.publish(1);
    frame();
    expect(log).toEqual(['0.75@3', '1@4']);
  });

  it('copies buffers, refuses ones too long, and never changes one delivered', () => {
    const received: Float32Array[] = [];
    // Unbound, as useSyncExternalStore calls them.
    const { get, subscribe: subscribeTo } = channels.spectrum;
    stops.push(subscribeTo((value) => received.push(value)));
    const values = new Float32Array([1, 2, 3]);
    expect(publish.spectrum.publish(values)).toBe(true);
    values[0] = 9;
    frame();
    expect(Array.from(received[0]!)).toEqual([1, 2, 3]);
    expect(get()).toBe(received[0]);
    expect(get()).toBe(get());
    expect(publish.spectrum.publish(new Float32Array(5))).toBe(false);
    expect(publish.spectrum.publish(new Float32Array([4, 5, 6]))).toBe(true);
    expect(publish.spectrum.publish(new Float32Array([7, 8, 9]))).toBe(true);
    frame();
    expect(received.map((value) => Array.from(value))).toEqual([
      [1, 2, 3],
      [7, 8, 9],
    ]);
    expect(get()).not.toBe(received[0]);
  });

  it('checks a published value as the native types do', () => {
    const untyped = publish as unknown as Record<
      string,
      { publish(value: unknown): unknown }
    >;
    expect(() => untyped['spectrum']!.publish([1, 2])).toThrow(
      'channels.spectrum.publish(): expected Float32Array, got array',
    );
    expect(() => untyped['level']!.publish('loud')).toThrow(
      'channels.level.publish(): expected float32, got string',
    );
    expect(() => untyped['frames']!.publish(1)).toThrow(
      'channels.frames.publish(): expected uint64, got number',
    );
    publish.frames.publish(9007199254740993n);
    frame();
    expect(channels.frames.get()).toBe(9007199254740993n);
  });

  it('a hidden page keeps only the latest value', () => {
    let count = 0;
    subscribe(channels.spectrum, () => ++count);
    for (let index = 0; index < 10000; index++)
      publish.spectrum.publish(new Float32Array([index]));
    // One frame asked for, however many were published.
    expect(frames).toHaveLength(1);
    frame();
    expect(count).toBe(1);
    expect(Array.from(channels.spectrum.get()!)).toEqual([9999]);
  });

  it('subscribers share a value; unsubscribing or throwing does not stop the others', () => {
    const reported = vi.fn<(error: unknown) => void>();
    vi.stubGlobal('reportError', reported);
    const seen: string[] = [];
    let first: unknown;
    const stopFirst = subscribe(channels.level, (value) => {
      seen.push('first');
      first = value;
    });
    subscribe(channels.level, () => {
      throw new Error('boom');
    });
    subscribe(channels.level, (value) => seen.push(`last ${value === first}`));
    publish.level.publish(0.5);
    frame();
    expect(seen).toEqual(['first', 'last true']);
    expect(reported).toHaveBeenCalledWith(new Error('boom'));
    stopFirst();
    publish.level.publish(0.25);
    frame();
    expect(seen).toEqual(['first', 'last true', 'last false']);
  });

  it('without animation frames, delivers on a timer', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('requestAnimationFrame', undefined);
    const values: number[] = [];
    subscribe(channels.level, (value) => values.push(value));
    publish.level.publish(0.125);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(values).toEqual([0.125]);
  });
});
