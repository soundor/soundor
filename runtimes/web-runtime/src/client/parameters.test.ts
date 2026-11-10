import { describe, expect, it, vi } from 'vitest';

import { publishParameter } from './parameters';
import { fixtureConfig } from './testing/fixture';
import { storeOf } from './testing/store';

/** The fixture plugin's parameters, with their generated behavior. */
function store() {
  return storeOf(fixtureConfig.parameters).byId as Record<string, any>;
}

const f32 = Math.fround;

describe('createParameterStore', () => {
  it('makes one parameter per declaration, by id and in order', () => {
    const parameters = storeOf(fixtureConfig.parameters);
    expect(parameters.list.map((parameter) => parameter.id)).toEqual([
      'gain',
      'steps',
      'bypass',
      'mode',
      'frequency',
      'trim',
      'reduction',
    ]);
    expect(parameters.byId['mode']).toBe(parameters.list[3]);
  });

  it('starts every parameter at its default', () => {
    const { gain, steps, bypass, mode, frequency } = store();
    expect([
      gain.get(),
      steps.get(),
      bypass.get(),
      mode.get(),
      frequency.get(),
    ]).toEqual([0.5, 4, false, 'warm', 1000]);
  });

  it('reports the declaration as frozen info, in the JUCE runtime shape', () => {
    const { mode, trim } = store();
    expect(mode.info).toEqual({
      id: 'mode',
      label: 'Mode',
      access: 'automatable',
      type: 'choice',
      options: [
        { value: 'clean', label: 'Clean' },
        { value: 'warm', label: 'Warm' },
        { value: 'hot', label: 'Hot' },
      ],
      default: 'warm',
    });
    expect(JSON.stringify(trim.info)).toBe(
      '{"id":"trim","label":"Trim","access":"manual","type":"float32","min":-24,"max":24,"default":0,"step":0.01,"unit":"dB"}',
    );
    expect(Object.isFrozen(mode.info)).toBe(true);
    expect(Object.isFrozen(mode.info.options[0])).toBe(true);
  });

  it('needs the behavior gen wrote for the manifest', async () => {
    const { createParameterStore } = await import('./parameters');
    expect(() =>
      createParameterStore(
        [
          {
            id: 'a',
            label: 'A',
            access: 'automatable',
            type: 'boolean',
            default: true,
          },
        ],
        [],
      ),
    ).toThrow(
      "The parameters' behavior (0) does not match the manifest (1); run soundor gen",
    );
  });
});

describe('WebParameter values', () => {
  it('are float32, snapped to their step and range', () => {
    const { gain, trim } = store();
    gain.set(0.1);
    expect(gain.get()).toBe(f32(0.1));
    gain.set(9);
    expect(gain.get()).toBe(1);
    trim.set(-3.456);
    expect(trim.get()).toBe(f32(-3.46));
    trim.set(-100);
    expect(trim.get()).toBe(-24);
  });

  it('round and clamp integers', () => {
    const { steps } = store();
    steps.set(6.6);
    expect(steps.get()).toBe(7);
    steps.set(-3);
    expect(steps.get()).toBe(1);
  });

  it('reject numbers of the wrong type and NaN', () => {
    const { gain, steps } = store();
    expect(() => gain.set(Number.NaN)).toThrow(
      new TypeError("Parameter 'gain' expects a number, got NaN"),
    );
    expect(() => steps.set('3')).toThrow(
      new TypeError("Parameter 'steps' expects a number, got '3'"),
    );
    expect(gain.get()).toBe(0.5);
  });

  it('take booleans only for booleans', () => {
    const { bypass } = store();
    bypass.set(true);
    expect(bypass.get()).toBe(true);
    expect(() => bypass.set(1)).toThrow(
      new TypeError("Parameter 'bypass' expects a boolean, got 1"),
    );
  });

  it("take only a choice's option values", () => {
    const { mode } = store();
    mode.set('hot');
    expect(mode.get()).toBe('hot');
    expect(() => mode.set('loud')).toThrow(
      new TypeError(
        "Parameter 'mode' expects one of 'clean', 'warm', 'hot', got 'loud'",
      ),
    );
    expect(() => mode.set('Hot')).toThrow(TypeError);
    expect(mode.get()).toBe('hot');
  });
});

describe('WebParameter access', () => {
  it('keeps a read-only parameter for the processing, which publishes it', () => {
    const { reduction } = store();
    const message =
      "Parameter 'reduction' is read-only: only the plugin's processing sets it";
    expect(() => reduction.set(-3)).toThrow(new TypeError(message));
    expect(() => reduction.beginGesture()).toThrow(new TypeError(message));
    reduction.endGesture();
    const seen: number[] = [];
    reduction.subscribe((value: number) => seen.push(value));
    publishParameter(reduction, -6.5);
    publishParameter(reduction, -100);
    expect(seen).toEqual([-6.5, -60]);
    expect(reduction.format()).toBe('-60.0 dB');
  });

  it('lets the UI set a manual parameter', () => {
    const { trim } = store();
    trim.beginGesture();
    trim.set(1.5);
    trim.endGesture();
    expect(trim.get()).toBe(1.5);
  });
});

describe('WebParameter text and normalized positions', () => {
  it("format and parse with the parameter's own expressions", () => {
    const { frequency, trim, mode, bypass } = store();
    expect(frequency.format()).toBe('1.00 kHz');
    expect(frequency.format(500)).toBe('500 Hz');
    expect(frequency.parse('1.25 kHz')).toBe(1250);
    expect(frequency.parse('500 Hz')).toBe(500);
    expect(frequency.parse('25 kHz')).toBeNull();
    expect(frequency.parse('invalid')).toBeNull();
    expect(trim.format(-3.5)).toBe('-3.50 dB');
    expect(trim.parse('-3.5 dB')).toBe(-3.5);
    expect(mode.format('hot')).toBe('Hot');
    expect(mode.parse('Hot')).toBe('hot');
    expect(bypass.format(true)).toBe('On');
    expect(bypass.parse('off')).toBe(false);
    expect(() => frequency.parse(1)).toThrow(
      new TypeError("Parameter 'frequency': parse() expects a string, got 1"),
    );
    expect(() => mode.format('loud')).toThrow(TypeError);
  });

  it('map through the declared curve, both ways', () => {
    const { frequency, steps, mode, trim } = store();
    expect(frequency.toNormalized(20)).toBe(0);
    expect(frequency.toNormalized(20000)).toBe(1);
    expect(frequency.fromNormalized(0.5)).toBe(f32(Math.sqrt(20 * 20000)));
    expect(frequency.toNormalized()).toBeCloseTo(
      Math.log(50) / Math.log(1000),
      7,
    );
    expect(steps.fromNormalized(0.5)).toBe(5);
    expect(mode.fromNormalized(1)).toBe('hot');
    expect(mode.toNormalized('warm')).toBe(0.5);
    expect(trim.fromNormalized(0.51)).toBe(f32(0.48));
    expect(frequency.fromNormalized(7)).toBe(20000);
    expect(() => frequency.fromNormalized(Number.NaN)).toThrow(
      new TypeError(
        "Parameter 'frequency': fromNormalized() expects a number, got NaN",
      ),
    );
  });
});

describe('WebParameter subscriptions', () => {
  it('notifies changes with the stored value, and only changes', () => {
    const { gain, steps } = store();
    const seen: number[] = [];
    gain.subscribe((value: number) => seen.push(value));
    gain.set(0.75);
    gain.set(0.75);
    gain.set(9);
    expect(seen).toEqual([0.75, 1]);

    const rounded: number[] = [];
    steps.subscribe((value: number) => rounded.push(value));
    steps.set(4.2); // rounds to the current value: no change
    steps.set(6.6);
    expect(rounded).toEqual([7]);
  });

  it('removes exactly the subscription unsubscribe belongs to', () => {
    const { gain } = store();
    const listener = vi.fn<(value: number) => void>();
    const first = gain.subscribe(listener);
    gain.subscribe(listener);
    gain.set(0.25);
    expect(listener).toHaveBeenCalledTimes(2);
    first();
    first();
    gain.set(0.75);
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

    gain.set(0.25);
    expect(calls).toEqual(['a', 'b']);
    calls.length = 0;
    gain.set(0.75);
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
    gain.set(0.875);
    expect(after).toHaveBeenCalledWith(0.875);
    expect(reported).toHaveBeenCalledWith(error);
    reported.mockRestore();
  });

  it('rejects a listener that is not a function', () => {
    const { gain } = store();
    expect(() => gain.subscribe(42)).toThrow(
      new TypeError("Parameter 'gain': subscribe() expects a function"),
    );
  });
});

describe('WebParameter gestures', () => {
  it('tracks nested interactions and ignores unbalanced ends', () => {
    const { gain } = store();
    expect(gain.inGesture).toBe(false);
    gain.beginGesture();
    gain.beginGesture();
    gain.endGesture();
    expect(gain.inGesture).toBe(true);
    gain.endGesture();
    gain.endGesture();
    expect(gain.inGesture).toBe(false);
  });
});
