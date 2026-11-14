import { resolveConfig } from '@soundor/config';
import { describe, expect, it, vi } from 'vitest';

import { createParameterStore, setParameterAsHost } from './parameters';
function store(): Record<string, any> {
  return createParameterStore(
    resolveConfig({
      plugin: { id: 'test.setters', name: 'Setters' },
      runtimes: [],
      parameters: {
        gain: { type: 'float32', min: 0, max: 1, default: 0.5 },
        steps: { type: 'int32', min: 1, max: 10, default: 4 },
        bypass: { type: 'boolean', default: false },
        mode: {
          type: 'choice',
          options: [
            { value: 'warm', label: 'Warm' },
            { value: 'hot', label: 'Hot' },
          ],
          default: 'warm',
        },
        trim: {
          type: 'float32',
          min: -24,
          max: 24,
          default: 0,
          access: 'manual',
        },
        reduction: {
          type: 'float32',
          min: -60,
          max: 0,
          default: 0,
          access: 'readOnly',
        },
      },
    }).parameters,
  ).byId;
}

describe('synchronous setters and automatic gestures', () => {
  it('uses current values exactly once and exposes automatic boundaries during publication', () => {
    const { gain, steps, bypass, mode, trim } = store();
    const events: unknown[] = [];
    gain.subscribe((value: unknown) => events.push([value, gain.inGesture]));
    const update = vi.fn<(current: number) => number>(
      (current: number) => current + 0.125,
    );
    gain.set(update);
    gain.set(update);
    expect(update.mock.calls).toEqual([[0.5], [0.625]]);
    expect(gain.get()).toBe(0.75);
    expect(events).toEqual([
      [0.625, true],
      [0.75, true],
    ]);
    expect(gain.inGesture).toBe(false);
    gain.set((current: number) => current);
    gain.set(0.75);
    expect(events).toHaveLength(2);
    steps.set((current: number) => current + 0.2);
    expect(steps.get()).toBe(4);
    steps.set((current: number) => current + 1);
    bypass.set((current: boolean) => !current);
    mode.set((current: string) => (current === 'warm' ? 'hot' : 'warm'));
    expect([steps.get(), bypass.get(), mode.get()]).toEqual([5, true, 'hot']);
    trim.subscribe(() => expect(trim.inGesture).toBe(false));
    trim.set((current: number) => current + 1);
  });
  it('preserves explicit and nested gesture depth across writes and failures', () => {
    const { gain } = store();
    gain.beginGesture();
    gain.beginGesture();
    gain.set((current: number) => current + 0.125);
    gain.set(0.875);
    expect(() =>
      gain.set(() => {
        throw new Error('failed');
      }),
    ).toThrow('failed');
    gain.endGesture();
    expect(gain.inGesture).toBe(true);
    gain.endGesture();
    gain.endGesture();
    expect(gain.inGesture).toBe(false);
  });
  it.each([
    () => 'invalid',
    () => {
      throw new Error('failed');
    },
    async () => 1,
    () => ({ then() {} }),
  ])(
    'rejects failed updater results without notifications or gestures',
    (updater) => {
      const { gain, reduction } = store();
      const listener = vi.fn<(...args: unknown[]) => void>(),
        call = vi.fn<typeof updater>(updater);
      gain.subscribe(listener);
      expect(() => gain.set(call)).toThrow(Error);
      expect(call).toHaveBeenCalledOnce();
      expect(gain.get()).toBe(0.5);
      expect(gain.inGesture).toBe(false);
      expect(listener).not.toHaveBeenCalled();
      const forbidden = vi.fn<() => number>(() => -1);
      expect(() => reduction.set(forbidden)).toThrow(/read-only/);
      expect(forbidden).not.toHaveBeenCalled();
    },
  );
  it('external writes create no user gesture', () => {
    const { gain } = store();
    const events: boolean[] = [];
    gain.subscribe(() => events.push(gain.inGesture));
    setParameterAsHost(gain, 0.75);
    expect(events).toEqual([false]);
  });
});
