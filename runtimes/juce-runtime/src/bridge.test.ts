import { describe, expect, it, vi } from 'vitest';

import {
  createJuceBridge,
  type JuceBridgeManifest,
  type JuceChannel,
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

function fakeChannel() {
  const posted: unknown[] = [];
  let listener: ((message: string) => void) | undefined;
  const channel: JuceChannel = {
    postMessage: (message) => posted.push(JSON.parse(message)),
    addEventListener: (l) => {
      listener = l;
      return () => {
        listener = undefined;
      };
    },
  };
  return {
    channel,
    posted,
    emit: (message: unknown) => listener?.(JSON.stringify(message)),
  };
}

describe('createJuceBridge', () => {
  it('seeds parameter defaults and info from the manifest', () => {
    const { channel } = fakeChannel();
    const bridge = createJuceBridge({ channel, manifest });
    expect(bridge.getParam('gain')).toBe(0.5);
    expect(bridge.getParamIds()).toEqual(['gain']);
    expect(bridge.getParamInfo('gain').label).toBe('Gain');
  });

  it('posts setParam and reflects it optimistically', () => {
    const fake = fakeChannel();
    const bridge = createJuceBridge({ channel: fake.channel, manifest });
    bridge.setParam('gain', 0.9);
    expect(bridge.getParam('gain')).toBe(0.9);
    expect(fake.posted).toContainEqual({
      type: 'setParam',
      id: 'gain',
      value: 0.9,
    });
  });

  it('delivers batched inbound param frames to subscribers', () => {
    const fake = fakeChannel();
    const bridge = createJuceBridge({ channel: fake.channel, manifest });
    const listener = vi.fn<(value: unknown) => void>();
    bridge.subscribeParam('gain', listener);
    fake.emit({ type: 'params', values: { gain: 0.25 } });
    expect(listener).toHaveBeenCalledWith(0.25);
    expect(bridge.getParam('gain')).toBe(0.25);
  });

  it('only notifies parameters whose value changed in a batched frame', () => {
    const fake = fakeChannel();
    const bridge = createJuceBridge({ channel: fake.channel, manifest });
    const listener = vi.fn<(value: unknown) => void>();
    bridge.subscribeParam('gain', listener);
    // gain is already 0.5 (manifest default): an unchanged frame is a no-op.
    fake.emit({ type: 'params', values: { gain: 0.5 } });
    expect(listener).not.toHaveBeenCalled();
    fake.emit({ type: 'params', values: { gain: 0.5 } });
    expect(listener).not.toHaveBeenCalled();
    fake.emit({ type: 'params', values: { gain: 0.8 } });
    expect(listener).toHaveBeenCalledExactlyOnceWith(0.8);
  });

  it('delivers the 60fps event stream to subscribers', () => {
    const fake = fakeChannel();
    const bridge = createJuceBridge({ channel: fake.channel, manifest });
    const handler = vi.fn<(payload: unknown) => void>();
    bridge.subscribeEvent('level', handler);
    fake.emit({ type: 'event', name: 'level', payload: 0.7 });
    expect(handler).toHaveBeenCalledWith(0.7);
  });

  it('resolves an allowlisted native call on a matching result', async () => {
    const fake = fakeChannel();
    const bridge = createJuceBridge({ channel: fake.channel, manifest });
    const promise = bridge.callNative('render', { frames: 128 });
    const call = fake.posted.find(
      (m): m is { type: string; id: number } =>
        typeof m === 'object' &&
        m !== null &&
        (m as { type: string }).type === 'call',
    );
    expect(call).toBeDefined();
    fake.emit({ type: 'result', id: call!.id, ok: true, value: 'done' });
    await expect(promise).resolves.toBe('done');
  });

  it('rejects a native method that is not allowlisted', async () => {
    const { channel } = fakeChannel();
    const bridge = createJuceBridge({ channel, manifest });
    await expect(bridge.callNative('danger' as never, {})).rejects.toThrow(
      /not allowlisted/,
    );
  });

  it('rejects an oversized native-call payload', async () => {
    const { channel } = fakeChannel();
    const bridge = createJuceBridge({ channel, manifest, maxPayloadBytes: 8 });
    await expect(
      bridge.callNative('render', { big: 'x'.repeat(1000) }),
    ).rejects.toThrow(/too large/);
  });

  it('falls back to a mock bridge when no WebView channel is present', () => {
    const bridge = createJuceBridge({ manifest });
    expect(bridge.getParamIds()).toEqual(['gain']);
    expect(bridge.getParam('gain')).toBe(0.5);
  });
});
