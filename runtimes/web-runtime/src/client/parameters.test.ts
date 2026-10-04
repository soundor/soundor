import { describe, expect, it, vi } from 'vitest';

import type { WebParameterInfo } from './manifest';
import { createParameterStore, WebParameter } from './parameters';
import { fixtureConfig } from './testing/fixture';

const infos = fixtureConfig.parameters as unknown as WebParameterInfo[];

function store() {
  const { byId } = createParameterStore(infos);
  return {
    gain: byId['gain'] as WebParameter<WebParameterInfo & { type: 'float' }>,
    steps: byId['steps'] as WebParameter<WebParameterInfo & { type: 'int' }>,
    bypass: byId['bypass'] as WebParameter<WebParameterInfo & { type: 'bool' }>,
    mode: byId['mode'] as WebParameter<WebParameterInfo & { type: 'enum' }>,
  };
}

describe('createParameterStore', () => {
  it('makes one parameter per declaration, by id and in order', () => {
    const parameters = createParameterStore(infos);
    expect(parameters.list.map((parameter) => parameter.id)).toEqual([
      'gain',
      'steps',
      'bypass',
      'mode',
    ]);
    expect(Object.keys(parameters.byId)).toEqual([
      'gain',
      'steps',
      'bypass',
      'mode',
    ]);
    expect(parameters.byId['gain']).toBe(parameters.list[0]);
    expect(Object.isFrozen(parameters.byId)).toBe(true);
  });

  it('starts every parameter at its default', () => {
    const { gain, steps, bypass, mode } = store();
    expect(gain.get()).toBe(0.5);
    expect(steps.get()).toBe(4);
    expect(bypass.get()).toBe(false);
    expect(mode.get()).toBe('warm');
  });

  it('reports the declaration as frozen info', () => {
    const { gain, mode } = store();
    expect(gain.id).toBe('gain');
    expect(gain.info).toEqual({
      id: 'gain',
      label: 'Gain',
      type: 'float',
      min: 0,
      max: 1,
      default: 0.5,
      unit: 'dB',
    });
    expect(Object.isFrozen(gain.info)).toBe(true);
    expect(Object.isFrozen(mode.info.type === 'enum' && mode.info.values)).toBe(
      true,
    );
    expect(Object.isFrozen(gain)).toBe(true);
  });
});

describe('WebParameter values', () => {
  it('clamps floats to the declared range', () => {
    const { gain } = store();
    gain.set(0.25);
    expect(gain.get()).toBe(0.25);
    gain.set(7);
    expect(gain.get()).toBe(1);
    gain.set(-Infinity);
    expect(gain.get()).toBe(0);
  });

  it('rounds and clamps ints', () => {
    const { steps } = store();
    steps.set(2.4);
    expect(steps.get()).toBe(2);
    steps.set(2.5);
    expect(steps.get()).toBe(3);
    steps.set(5.6);
    expect(steps.get()).toBe(6);
    steps.set(100);
    expect(steps.get()).toBe(8);
    steps.set(-3.7);
    expect(steps.get()).toBe(1);
  });

  it('rejects numbers of the wrong type and NaN', () => {
    const { gain, steps } = store();
    expect(() => gain.set(Number.NaN)).toThrow(
      new TypeError("Parameter 'gain' expects a number, got NaN"),
    );
    expect(() => steps.set('3' as unknown as number)).toThrow(
      new TypeError("Parameter 'steps' expects a number, got '3'"),
    );
    expect(gain.get()).toBe(0.5);
  });

  it('takes booleans only for bools', () => {
    const { bypass } = store();
    bypass.set(true);
    expect(bypass.get()).toBe(true);
    expect(() => bypass.set(1 as unknown as boolean)).toThrow(
      new TypeError("Parameter 'bypass' expects a boolean, got 1"),
    );
    expect(bypass.get()).toBe(true);
  });

  it('takes only declared values for enums', () => {
    const { mode } = store();
    mode.set('hot');
    expect(mode.get()).toBe('hot');
    expect(() => mode.set('loud')).toThrow(
      new TypeError(
        "Parameter 'mode' expects one of 'clean', 'warm', 'hot', got 'loud'",
      ),
    );
    expect(() => mode.set(1 as unknown as string)).toThrow(TypeError);
    expect(mode.get()).toBe('hot');
  });
});

describe('WebParameter subscriptions', () => {
  it('notifies changes with the stored value, and only changes', () => {
    const { gain, steps } = store();
    const seen: number[] = [];
    gain.subscribe((value) => seen.push(value));
    gain.set(0.75);
    gain.set(0.75);
    gain.set(9);
    expect(seen).toEqual([0.75, 1]);

    const rounded: number[] = [];
    steps.subscribe((value) => rounded.push(value));
    steps.set(4.2); // rounds to the current value: no change
    steps.set(6.6);
    expect(rounded).toEqual([7]);
  });

  it('removes exactly the subscription unsubscribe belongs to', () => {
    const { gain } = store();
    const listener = vi.fn<(value: number) => void>();
    const first = gain.subscribe(listener);
    gain.subscribe(listener);
    gain.set(0.1);
    expect(listener).toHaveBeenCalledTimes(2);
    first();
    first();
    gain.set(0.2);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('keeps a notification stable while listeners (un)subscribe', () => {
    const { gain } = store();
    const calls: string[] = [];
    let unsubscribeB = (): void => {};
    gain.subscribe(() => {
      calls.push('a');
      unsubscribeB();
      gain.subscribe(() => calls.push('late'));
    });
    unsubscribeB = gain.subscribe(() => calls.push('b'));

    gain.set(0.3);
    expect(calls).toEqual(['a', 'b']);
    calls.length = 0;
    gain.set(0.4);
    expect(calls).toEqual(['a', 'late']);
  });

  it('reports a throwing listener and still calls the others', () => {
    const { gain } = store();
    const error = new Error('boom');
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn<(value: number) => void>();
    gain.subscribe(() => {
      throw error;
    });
    gain.subscribe(after);
    gain.set(0.9);
    expect(after).toHaveBeenCalledWith(0.9);
    expect(reported).toHaveBeenCalledWith(error);
    reported.mockRestore();
  });

  it('rejects a listener that is not a function', () => {
    const { gain } = store();
    expect(() => gain.subscribe(42 as never)).toThrow(
      new TypeError("Parameter 'gain': subscribe() expects a function"),
    );
  });
});

describe('WebParameter gestures', () => {
  it('tracks nested interactions and ignores unbalanced ends', () => {
    const { gain } = store();
    expect(gain.inGesture).toBe(false);
    gain.endGesture();
    expect(gain.inGesture).toBe(false);
    gain.beginGesture();
    gain.beginGesture();
    gain.set(0.6);
    gain.endGesture();
    expect(gain.inGesture).toBe(true);
    gain.endGesture();
    expect(gain.inGesture).toBe(false);
    expect(gain.get()).toBe(0.6);
  });
});
