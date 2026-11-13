// The events of soundor:native in the browser: published by the project's
// native.ts through the generated contract's `events`, delivered to the
// plugin UI's subscribers afterwards, as the JUCE runtime does (the engine's
// tests/native/NativeEventsTests.cpp checks the same behaviour).

import { events } from 'soundor:native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EVENT_CAPACITY } from './native-events';
import { events as publish } from './testing/native';

/** Lets the page deliver what was published. */
const delivered = () => new Promise((resolve) => setTimeout(resolve, 0));

const stops: (() => void)[] = [];
function subscribe<T>(
  event: { subscribe(listener: (value: T) => void): () => void },
  listener: (value: T) => void,
) {
  const stop = event.subscribe(listener);
  stops.push(stop);
  return stop;
}

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.restoreAllMocks();
});

describe('soundor:native events', () => {
  it('exports one frozen subscribable event per declaration', () => {
    expect(Object.keys(events).sort()).toEqual([
      'levels',
      'presetLoaded',
      'ready',
    ]);
    expect(Object.isFrozen(events)).toBe(true);
    expect(Object.isFrozen(events.ready)).toBe(true);
    expect(() =>
      events.ready.subscribe(1 as unknown as () => void),
    ).toThrowError(
      new TypeError('events.ready.subscribe() expects a function, got number'),
    );
  });

  it('delivers checked copies in the order published, after the call', async () => {
    const log: string[] = [];
    subscribe(events.presetLoaded, ({ path, preset }) =>
      log.push(
        `loaded ${path} ${preset === null ? 'none' : `${preset.name}:${preset.gains.join('/')}`}`,
      ),
    );
    subscribe(events.levels, ({ values, curve }) =>
      log.push(
        `levels ${values.constructor.name} ${Array.from(values).join('/')} ${curve}`,
      ),
    );
    subscribe(events.ready, (value) =>
      log.push(`ready ${Object.keys(value).length}`),
    );
    const values = new Float32Array([0.5, 0.25]);
    expect(
      publish.presetLoaded({
        path: 'a.json',
        preset: { name: 'Warm', gains: [1, 2] },
      }),
    ).toBe(true);
    expect(publish.levels({ values, curve: 'exponential' })).toBe(true);
    expect(publish.ready()).toBe(true);
    expect(publish.presetLoaded({ path: 'b.json', preset: null })).toBe(true);
    // Nothing runs inside the publishing call.
    expect(log).toEqual([]);
    values[0] = 9;
    await delivered();
    expect(log).toEqual([
      'loaded a.json Warm:1/2',
      'levels Float32Array 0.5/0.25 exponential',
      'ready 0',
      'loaded b.json none',
    ]);
  });

  it('checks a published value as the native bindings do', () => {
    const untyped = publish as unknown as Record<
      string,
      (value?: unknown) => boolean
    >;
    expect(() => untyped['presetLoaded']!({ path: 1, preset: null })).toThrow(
      'events.presetLoaded(): path: expected string, got number',
    );
    expect(() =>
      untyped['levels']!({ values: [0.5], curve: 'linear' }),
    ).toThrow('events.levels(): values: expected Float32Array, got array');
    expect(() => untyped['presetLoaded']!()).toThrow(
      'events.presetLoaded(): expected object, got undefined',
    );
  });

  it('every subscriber receives the same value; unsubscribing stops one', async () => {
    const seen: string[] = [];
    let first: unknown;
    const stopFirst = subscribe(events.presetLoaded, (value) => {
      seen.push(`first ${value.path}`);
      first = value;
    });
    let same = false;
    subscribe(events.presetLoaded, (value) => {
      seen.push(`second ${value.path}`);
      same = value === first;
    });
    publish.presetLoaded({ path: 'x', preset: null });
    await delivered();
    expect(seen).toEqual(['first x', 'second x']);
    expect(same).toBe(true);
    stopFirst();
    stopFirst();
    publish.presetLoaded({ path: 'y', preset: null });
    await delivered();
    expect(seen).toEqual(['first x', 'second x', 'second y']);
  });

  it('subscribing or unsubscribing during a delivery', async () => {
    const seen: string[] = [];
    let stopSecond = () => {};
    subscribe(events.ready, () => {
      seen.push('first');
      stopSecond();
      subscribe(events.ready, () => seen.push('late'));
    });
    stopSecond = subscribe(events.ready, () => seen.push('second'));
    publish.ready();
    await delivered();
    expect(seen).toEqual(['first']);
    publish.ready();
    await delivered();
    expect(seen).toEqual(['first', 'first', 'late']);
  });

  it('a throwing subscriber is reported and the others still run', async () => {
    const reported = vi.fn();
    vi.stubGlobal('reportError', reported);
    const seen: string[] = [];
    subscribe(events.ready, () => {
      throw new Error('boom');
    });
    subscribe(events.ready, () => seen.push('after'));
    publish.ready();
    await delivered();
    vi.unstubAllGlobals();
    expect(seen).toEqual(['after']);
    expect(reported).toHaveBeenCalledWith(new Error('boom'));
  });

  it('a full page drops newer events and reports them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let count = 0;
    subscribe(events.ready, () => ++count);
    for (let index = 0; index < EVENT_CAPACITY; index++)
      expect(publish.ready()).toBe(true);
    expect(publish.ready()).toBe(false);
    expect(publish.ready()).toBe(false);
    await delivered();
    expect(count).toBe(EVENT_CAPACITY);
    expect(warn).toHaveBeenCalledWith(
      `soundor:native: 2 events were dropped: the UI did not take them in time (it holds ${EVENT_CAPACITY})`,
    );
    expect(publish.ready()).toBe(true);
    await delivered();
    expect(count).toBe(EVENT_CAPACITY + 1);
  });
});
