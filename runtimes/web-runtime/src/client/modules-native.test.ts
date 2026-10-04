// Plugin code calling soundor:native, which the runtime's Vite plugin makes
// from the manifest, into an implementation typed by the generated contract.

import * as native from 'soundor:native';
import { describe, expect, it } from 'vitest';

import { installNative } from './native';
import { Preset, type WebNativeApi } from './testing/native';

/** The project's runtimes/web/src/native.ts, for the fixture plugin. */
const implementation: WebNativeApi = {
  analyze(samples) {
    const rms = Math.sqrt(
      samples.reduce((sum, x) => sum + x * x, 0) / samples.length,
    );
    return { rms, peaks: [Math.max(...samples)] };
  },
  scale: (values, factor) => values.map((value) => value * factor),
  invert: (on) => !on,
  echo: (data) => data.buffer as ArrayBuffer,
  setCurve(curve) {
    if (curve !== 'linear') throw new RangeError(`no ${curve} curve here`);
  },
  loadPreset: async (path) =>
    Preset.wrap({ path, name: path.split('/').pop() }),
  presetName: (preset) => Preset.unwrap<{ name: string }>(preset).name,
  fail() {
    throw new Error('disk full');
  },
  failLater: () => Promise.reject(new Error('later')),
};

describe('soundor:native', () => {
  it('exports every declared method', () => {
    expect(Object.keys(native).sort()).toEqual([
      'analyze',
      'echo',
      'fail',
      'failLater',
      'invert',
      'loadPreset',
      'presetName',
      'scale',
      'setCurve',
    ]);
    expect(native.analyze.name).toBe('analyze');
  });

  it('says what is missing before an implementation is installed', async () => {
    expect(() => native.invert(true)).toThrow(
      /invert\(\) has no Web implementation\. Implement it in runtimes\/web\/src\/native\.ts/,
    );
    await expect(native.failLater()).rejects.toThrow(
      /failLater\(\) has no Web implementation/,
    );
  });

  it('rejects an implementation that misses methods', () => {
    expect(() => installNative({ native: { invert: () => true } })).toThrow(
      new TypeError(
        'runtimes/web/src/native.ts does not implement analyze(), echo(), fail(), failLater(), loadPreset(), presetName(), scale(), setCurve()',
      ),
    );
    expect(() => installNative({})).toThrow(
      "runtimes/web/src/native.ts must export the native API implementation as 'native'",
    );
  });

  it('calls the implementation directly: values cross unchanged', async () => {
    installNative({ native: implementation });
    const samples = new Float32Array([0.5, -0.5, 1, -1]);
    expect(native.analyze(samples)).toEqual({
      rms: Math.sqrt(0.625),
      peaks: [1],
    });
    expect(native.scale([1, 2], 3)).toEqual([3, 6]);
    expect(native.invert(false)).toBe(true);
    const bytes = new Uint8Array([1, 2, 3]);
    // The very same buffer: no copy, no serialization.
    expect(native.echo(bytes)).toBe(bytes.buffer);
    expect(native.setCurve('linear')).toBeUndefined();
  });

  it('keeps exceptions as errors and promises as promises', async () => {
    installNative({ native: implementation });
    expect(() => native.fail()).toThrow(new Error('disk full'));
    expect(() => native.setCurve('exponential')).toThrow(RangeError);
    const pending = native.failLater();
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toThrow('later');
  });

  it('hands out opaque handles that only their type can open', async () => {
    installNative({ native: implementation });
    const preset = await native.loadPreset('presets/warm.json');
    expect(Object.isFrozen(preset)).toBe(true);
    expect(Object.keys(preset)).toEqual([]);
    expect(String(preset)).toBe('[object Preset]');
    expect(native.presetName(preset)).toBe('warm.json');
    const forged = { __soundorHandle: 'Preset' } as const;
    expect(() => native.presetName(forged as never)).toThrow(
      new TypeError('expected a Preset handle'),
    );
  });
});
