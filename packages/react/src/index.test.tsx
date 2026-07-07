import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  SoundorProvider,
  createMockBridge,
  useEvent,
  useEventValue,
  useNative,
  useParam,
  useParamInfo,
  useParams,
} from './index';

declare module '@soundor/bridge' {
  interface SoundorParamValueMap {
    bypass: boolean;
    gain: number;
  }

  interface SoundorEventMap {
    meter: { peak: number };
  }

  interface SoundorNativeMethodRequests {
    render: { frames: number };
  }

  interface SoundorNativeMethodResponses {
    render: { ok: true };
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
} as const;

function createWrapper(bridge: ReturnType<typeof createMockBridge>) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <SoundorProvider bridge={bridge}>{children}</SoundorProvider>;
  };
}

describe('@soundor/react', () => {
  it('reads parameter values and reflects external updates', () => {
    const bridge = createMockBridge({ parameters });
    const { result } = renderHook(() => useParam('gain'), {
      wrapper: createWrapper(bridge),
    });

    expect(result.current[0]).toBe(0.5);

    act(() => {
      bridge.updateParam('gain', 0.75);
    });

    expect(result.current[0]).toBe(0.75);
  });

  it('returns a stable parameter setter', () => {
    const bridge = createMockBridge({ parameters });
    const { rerender, result } = renderHook(() => useParam('gain'), {
      wrapper: createWrapper(bridge),
    });
    const firstSetter = result.current[1];

    rerender();

    expect(result.current[1]).toBe(firstSetter);
  });

  it('sets parameter values through the bridge', () => {
    const bridge = createMockBridge({ parameters });
    const { result } = renderHook(() => useParam('gain'), {
      wrapper: createWrapper(bridge),
    });

    act(() => {
      result.current[1](0.25);
    });

    expect(result.current[0]).toBe(0.25);
  });

  it('returns all parameter states and metadata', () => {
    const bridge = createMockBridge({ parameters });
    const { result: params } = renderHook(() => useParams(), {
      wrapper: createWrapper(bridge),
    });
    const { result: info } = renderHook(() => useParamInfo('gain'), {
      wrapper: createWrapper(bridge),
    });

    expect(params.current.gain.value).toBe(0.5);
    expect(params.current.bypass.value).toBe(false);
    expect(info.current.unit).toBe('dB');
  });

  it('calls native methods through the bridge', async () => {
    const bridge = createMockBridge({ parameters });
    bridge.setNativeHandler('render', async (payload) => ({
      ok: payload.frames === 128,
    }));
    const { result } = renderHook(() => useNative(), {
      wrapper: createWrapper(bridge),
    });

    await expect(
      result.current.call('render', { frames: 128 }),
    ).resolves.toEqual({
      ok: true,
    });
  });

  it('unsubscribes event handlers on unmount', () => {
    const bridge = createMockBridge({ parameters });
    const handler = vi.fn<(payload: { peak: number }) => void>();
    const { unmount } = renderHook(() => useEvent('meter', handler), {
      wrapper: createWrapper(bridge),
    });

    act(() => {
      bridge.emitEvent('meter', { peak: 0.8 });
    });
    unmount();
    act(() => {
      bridge.emitEvent('meter', { peak: 0.2 });
    });

    expect(handler).toHaveBeenCalledExactlyOnceWith({ peak: 0.8 });
  });

  it('stores the latest event value', () => {
    const bridge = createMockBridge({ parameters });
    const { result } = renderHook(() => useEventValue('meter'), {
      wrapper: createWrapper(bridge),
    });

    expect(result.current).toBeUndefined();

    act(() => {
      bridge.emitEvent('meter', { peak: 0.8 });
    });

    expect(result.current).toEqual({ peak: 0.8 });
  });
});
