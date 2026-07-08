import { describe, expect, it } from 'vitest';

import { SOUNDOR_BRIDGE_ID, soundorBridgePlugin } from './bridge-plugin';

/** Invokes a Vite plugin hook that may be a function or `{ handler }`. */
function callHook(hook: unknown, arg: string): unknown {
  const fn =
    typeof hook === 'function' ? hook : (hook as { handler: unknown }).handler;
  return (fn as (this: unknown, a: string) => unknown).call({}, arg);
}

describe('soundorBridgePlugin', () => {
  it('resolves the virtual bridge id and ignores others', () => {
    const plugin = soundorBridgePlugin();
    expect(callHook(plugin.resolveId, SOUNDOR_BRIDGE_ID)).toBe(
      `\0${SOUNDOR_BRIDGE_ID}`,
    );
    expect(callHook(plugin.resolveId, 'react')).toBeUndefined();
  });

  it('re-exports the runtime bridge entry when provided', () => {
    const plugin = soundorBridgePlugin({
      entry: '@soundor/juce-runtime/bridge',
    });
    const code = callHook(plugin.load, `\0${SOUNDOR_BRIDGE_ID}`) as string;
    expect(code).toContain(`export * from "@soundor/juce-runtime/bridge"`);
    expect(code).toContain(
      `export { bridge as default } from "@soundor/juce-runtime/bridge"`,
    );
  });

  it('falls back to the mock bridge when no runtime entry is supplied', () => {
    const plugin = soundorBridgePlugin();
    const code = callHook(plugin.load, `\0${SOUNDOR_BRIDGE_ID}`) as string;
    expect(code).toContain('createMockBridge');
    expect(code).toContain('export default bridge');
  });

  it('does not handle unrelated module ids', () => {
    const plugin = soundorBridgePlugin({ entry: 'x' });
    expect(callHook(plugin.load, 'some-other-id')).toBeUndefined();
  });
});
