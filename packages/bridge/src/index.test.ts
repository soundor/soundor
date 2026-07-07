import { describe, expect, it, vi } from 'vitest';

import { createMockBridge, type SoundorEventMap } from './index';

declare module './index' {
  interface SoundorEventMap {
    meter: { peak: number };
  }
}

const parameters = {
  bypass: { default: false, id: 'bypass', label: 'Bypass', type: 'bool' },
  gain: {
    default: 0.5,
    id: 'gain',
    label: 'Gain',
    max: 1,
    min: 0,
    type: 'float',
    unit: 'dB',
  },
  mode: {
    default: 'stereo',
    id: 'mode',
    label: 'Mode',
    type: 'enum',
    values: ['mono', 'stereo'],
  },
} as const;

describe('createMockBridge', () => {
  it('initializes parameters from defaults', () => {
    const bridge = createMockBridge({ parameters });

    expect(bridge.getParam('bypass')).toBe(false);
    expect(bridge.getParam('gain')).toBe(0.5);
    expect(bridge.getParam('mode')).toBe('stereo');
    expect(bridge.getParamInfo('gain').unit).toBe('dB');
    expect(bridge.getParamIds()).toEqual(['bypass', 'gain', 'mode']);
  });

  it('notifies and unsubscribes parameter listeners', () => {
    const bridge = createMockBridge({ parameters });
    const listener = vi.fn<(value: number) => void>();
    const unsubscribe = bridge.subscribeParam('gain', listener);

    bridge.updateParam('gain', 0.75);
    unsubscribe();
    bridge.updateParam('gain', 0.25);

    expect(listener).toHaveBeenCalledExactlyOnceWith(0.75);
  });

  it('resolves and rejects native handlers', async () => {
    const bridge = createMockBridge<
      typeof parameters,
      { render: { frames: number }; fail: undefined },
      { render: { ok: true }; fail: never }
    >({
      parameters,
      nativeMethods: {
        render: async () => ({ ok: true }),
        fail: async () => {
          throw new Error('blocked');
        },
      },
    });

    await expect(bridge.callNative('render', { frames: 128 })).resolves.toEqual(
      {
        ok: true,
      },
    );
    await expect(bridge.callNative('fail', undefined)).rejects.toThrow(
      'blocked',
    );
  });

  it('notifies and unsubscribes event listeners', () => {
    const bridge = createMockBridge<
      typeof parameters,
      Record<string, unknown>,
      Record<string, unknown>,
      SoundorEventMap
    >({ parameters });
    const listener = vi.fn<(payload: { peak: number }) => void>();
    const unsubscribe = bridge.subscribeEvent('meter', listener);

    bridge.emitEvent('meter', { peak: 0.8 });
    unsubscribe();
    bridge.emitEvent('meter', { peak: 0.2 });

    expect(listener).toHaveBeenCalledExactlyOnceWith({ peak: 0.8 });
  });
});
