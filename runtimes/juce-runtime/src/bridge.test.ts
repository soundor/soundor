import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBridge,
  createJuceBridge,
  SOUNDOR_EVENT,
  type JuceBackend,
  type JuceBridgeManifest,
} from './bridge';

const manifest: JuceBridgeManifest = {
  parameters: {
    gain: {
      id: 'gain',
      label: 'Gain',
      type: 'float',
      default: 0.5,
      min: 0,
      max: 1,
    },
  },
  nativeMethods: ['render'],
};

/**
 * A faithful stand-in for JUCE's `window.__JUCE__.backend`, mirroring
 * `modules/juce_gui_extra/native/javascript/check_native_interop.js`:
 * - `addEventListener(eventId, fn)` returns a `[eventId, id]` handle;
 * - `removeEventListener([eventId, id])` takes that handle back;
 * - `emitEvent(eventId, object)` carries a structured object (UI → native);
 * - `deliver(eventId, object)` models the native → UI direction (what C++
 *   `emitEventIfBrowserIsVisible` triggers via `emitByBackend`), calling
 *   listeners with an already-parsed object.
 */
function fakeBackend() {
  type Handle = readonly [string, number];
  const listeners = new Map<
    number,
    { eventId: string; fn: (p: unknown) => void }
  >();
  const emitted: Array<{ eventId: string; payload: unknown }> = [];
  let nextId = 0;

  const backend: JuceBackend = {
    addEventListener(eventId, fn) {
      const id = nextId++;
      listeners.set(id, { eventId, fn });
      return [eventId, id] as Handle;
    },
    removeEventListener(handle) {
      const [, id] = handle as Handle;
      listeners.delete(id);
    },
    emitEvent(eventId, payload) {
      emitted.push({ eventId, payload });
    },
  };

  return {
    backend,
    /** Objects the bridge sent to native, scoped to the soundor event. */
    posted: emitted,
    listenerCount: () => listeners.size,
    /** native → UI on the soundor event; JUCE hands listeners a parsed object. */
    deliver: (payload: unknown) => {
      for (const { eventId, fn } of listeners.values())
        if (eventId === SOUNDOR_EVENT) fn(payload);
    },
  };
}

describe('createJuceBridge', () => {
  it('seeds parameter defaults and info from the manifest', () => {
    const { backend } = fakeBackend();
    const bridge = createJuceBridge({ backend, manifest });
    expect(bridge.getParam('gain')).toBe(0.5);
    expect(bridge.getParamIds()).toEqual(['gain']);
    expect(bridge.getParamInfo('gain').label).toBe('Gain');
  });

  it('emits setParam as a structured object and reflects it optimistically', () => {
    const fake = fakeBackend();
    const bridge = createJuceBridge({ backend: fake.backend, manifest });
    bridge.setParam('gain', 0.9);
    expect(bridge.getParam('gain')).toBe(0.9);
    expect(fake.posted).toContainEqual({
      eventId: SOUNDOR_EVENT,
      payload: { type: 'setParam', id: 'gain', value: 0.9 },
    });
  });

  it('subscribes on the soundor event and delivers batched param frames', () => {
    const fake = fakeBackend();
    const bridge = createJuceBridge({ backend: fake.backend, manifest });
    const listener = vi.fn<(value: unknown) => void>();
    bridge.subscribeParam('gain', listener);
    fake.deliver({ type: 'params', values: { gain: 0.25 } });
    expect(listener).toHaveBeenCalledWith(0.25);
    expect(bridge.getParam('gain')).toBe(0.25);
  });

  it('only notifies parameters whose value changed in a batched frame', () => {
    const fake = fakeBackend();
    const bridge = createJuceBridge({ backend: fake.backend, manifest });
    const listener = vi.fn<(value: unknown) => void>();
    bridge.subscribeParam('gain', listener);
    // gain is already 0.5 (manifest default): an unchanged frame is a no-op.
    fake.deliver({ type: 'params', values: { gain: 0.5 } });
    expect(listener).not.toHaveBeenCalled();
    fake.deliver({ type: 'params', values: { gain: 0.5 } });
    expect(listener).not.toHaveBeenCalled();
    fake.deliver({ type: 'params', values: { gain: 0.8 } });
    expect(listener).toHaveBeenCalledExactlyOnceWith(0.8);
  });

  it('delivers the 60fps event stream to subscribers', () => {
    const fake = fakeBackend();
    const bridge = createJuceBridge({ backend: fake.backend, manifest });
    const handler = vi.fn<(payload: unknown) => void>();
    bridge.subscribeEvent('level', handler);
    fake.deliver({ type: 'event', name: 'level', payload: 0.7 });
    expect(handler).toHaveBeenCalledWith(0.7);
  });

  it('ignores a non-object frame instead of crashing the UI', () => {
    const fake = fakeBackend();
    const bridge = createJuceBridge({ backend: fake.backend, manifest });
    const listener = vi.fn<(value: unknown) => void>();
    bridge.subscribeParam('gain', listener);
    expect(() => fake.deliver('not an object')).not.toThrow();
    expect(() => fake.deliver(null)).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('resolves an allowlisted native call on a matching result', async () => {
    const fake = fakeBackend();
    const bridge = createJuceBridge({ backend: fake.backend, manifest });
    const promise = bridge.callNative('render', { frames: 128 });
    const call = fake.posted
      .map((entry) => entry.payload)
      .find(
        (m): m is { type: string; id: number } =>
          typeof m === 'object' &&
          m !== null &&
          (m as { type: string }).type === 'call',
      );
    expect(call).toBeDefined();
    fake.deliver({ type: 'result', id: call!.id, ok: true, value: 'done' });
    await expect(promise).resolves.toBe('done');
  });

  it('rejects a native method that is not allowlisted', async () => {
    const { backend } = fakeBackend();
    const bridge = createJuceBridge({ backend, manifest });
    await expect(bridge.callNative('danger' as never, {})).rejects.toThrow(
      /not allowlisted/,
    );
  });

  it('rejects an oversized native-call payload', async () => {
    const { backend } = fakeBackend();
    const bridge = createJuceBridge({ backend, manifest, maxPayloadBytes: 8 });
    await expect(
      bridge.callNative('render', { big: 'x'.repeat(1000) }),
    ).rejects.toThrow(/too large/);
  });

  it('falls back to a mock bridge when no JUCE backend is present', () => {
    const bridge = createJuceBridge({ manifest });
    expect(bridge.getParamIds()).toEqual(['gain']);
    expect(bridge.getParam('gain')).toBe(0.5);
  });
});

describe('createBridge over the real window.__JUCE__ shape', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  function installWindow(fake: ReturnType<typeof fakeBackend>) {
    (globalThis as { window?: unknown }).window = {
      __JUCE__: { backend: fake.backend },
      __SOUNDOR__: manifest,
    };
  }

  it('builds a backend-backed bridge, not a mock, when JUCE is present', () => {
    const fake = fakeBackend();
    installWindow(fake);
    const bridge = createBridge({ parameters: manifest.parameters });
    // A mock resolves callNative locally; the real bridge emits to the backend.
    void bridge.callNative('render' as never, { frames: 1 } as never);
    expect(fake.posted).toContainEqual({
      eventId: SOUNDOR_EVENT,
      payload: expect.objectContaining({ type: 'call', name: 'render' }),
    });
  });

  it('reads the manifest from window.__SOUNDOR__ when none is passed', () => {
    const fake = fakeBackend();
    installWindow(fake);
    const bridge = createBridge({ parameters: {} });
    // Params/allowlist come from the injected manifest, not the seed.
    expect(bridge.getParamIds()).toEqual(['gain']);
    expect(bridge.getParam('gain' as never)).toBe(0.5);
  });

  it('receives object payloads emitted from the native host', () => {
    const fake = fakeBackend();
    installWindow(fake);
    const bridge = createBridge({ parameters: manifest.parameters });
    const listener = vi.fn<(value: unknown) => void>();
    bridge.subscribeParam('gain' as never, listener);
    fake.deliver({ type: 'params', values: { gain: 0.25 } });
    expect(listener).toHaveBeenCalledWith(0.25);
    expect(bridge.getParam('gain' as never)).toBe(0.25);
  });

  it('falls back to a mock bridge when window.__JUCE__ has no backend', () => {
    (globalThis as { window?: unknown }).window = { __SOUNDOR__: manifest };
    const bridge = createBridge({ parameters: manifest.parameters });
    expect(bridge.getParam('gain' as never)).toBe(0.5);
  });
});
