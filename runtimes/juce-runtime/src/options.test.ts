import { describe, expect, it } from 'vitest';

import { fourCharCode, resolveJuceOptions } from './options';

const plugin = { id: 'com.acme.reverb', name: 'Acme Reverb' };

describe('resolveJuceOptions', () => {
  it('derives every JUCE identity from the plugin', () => {
    const resolved = resolveJuceOptions({}, plugin);
    expect(resolved).toEqual({
      engineMode: 'prebuilt',
      jucePath: undefined,
      formats: ['vst3'],
      bundleId: 'com.acme.reverb',
      pluginName: 'Acme Reverb',
      companyName: 'acme',
      pluginCode: fourCharCode(undefined, 'com.acme.reverb'),
      manufacturerCode: fourCharCode(undefined, 'com.acme'),
      timeLimit: 5000,
      macosDeploymentTarget: '12.0',
    });
  });

  describe('macos.deploymentTarget', () => {
    const resolve = (deploymentTarget: string) =>
      resolveJuceOptions({ macos: { deploymentTarget } }, plugin)
        .macosDeploymentTarget;

    it.each(['12.0', '12', '12.3', '13.0', '15.4.1', '26.0'])(
      'takes %s',
      (version) => {
        expect(resolve(version)).toBe(version);
      },
    );

    it.each(['11.0', '11.7.10', '10.15', '9'])(
      'refuses %s, below the engine',
      (version) => {
        expect(() => resolve(version)).toThrow(
          `is ${version}, but the Soundor engine needs macOS 12.0 or later`,
        );
      },
    );

    it.each(['', 'latest', '13.x', '13.0.0.0', 'v13'])(
      'refuses %j, not a version',
      (version) => {
        expect(() => resolve(version)).toThrow('is a macOS version');
      },
    );
  });

  it('uses prebuilt selection unless source compilation is requested', () => {
    expect(resolveJuceOptions({}, plugin).engineMode).toBe('prebuilt');
    expect(
      resolveJuceOptions({ engine: { mode: 'prebuilt' } }, plugin).engineMode,
    ).toBe('prebuilt');
    expect(
      resolveJuceOptions({ engine: { mode: 'source' } }, plugin).engineMode,
    ).toBe('source');
    expect(() =>
      resolveJuceOptions({ engine: { mode: 'unknown' as 'source' } }, plugin),
    ).toThrow(/"prebuilt" or "source", not "unknown"/);
  });

  it('takes a time limit in milliseconds, or none', () => {
    expect(resolveJuceOptions({ timeLimit: 60_000 }, plugin).timeLimit).toBe(
      60_000,
    );
    expect(resolveJuceOptions({ timeLimit: false }, plugin).timeLimit).toBe(0);
  });

  it('rejects a time limit that is not a whole number of milliseconds', () => {
    for (const timeLimit of [0, -1, 1.5, Number.NaN, Infinity, 2 ** 32]) {
      expect(() => resolveJuceOptions({ timeLimit }, plugin)).toThrow(
        /juceRuntime\(\{ timeLimit \}\) must be a whole number of milliseconds/,
      );
    }
  });

  it('keeps explicit JUCE options', () => {
    const resolved = resolveJuceOptions(
      {
        formats: ['vst3', 'au'],
        companyName: 'Acme Audio',
        pluginCode: 'Rvb1',
        manufacturerCode: 'Acme',
      },
      plugin,
    );
    expect(resolved).toMatchObject({
      formats: ['vst3', 'au'],
      companyName: 'Acme Audio',
      pluginCode: 'Rvb1',
      manufacturerCode: 'Acme',
    });
  });

  it('falls back when formats is empty', () => {
    expect(resolveJuceOptions({ formats: [] }, plugin).formats).toEqual([
      'vst3',
    ]);
  });

  it('gives plugins of one vendor distinct plugin codes and a shared manufacturer code', () => {
    const reverb = resolveJuceOptions({}, plugin);
    const delay = resolveJuceOptions({}, { id: 'com.acme.delay', name: 'D' });
    expect(reverb.pluginCode).not.toBe(delay.pluginCode);
    expect(reverb.manufacturerCode).toBe(delay.manufacturerCode);
  });
});

describe('fourCharCode', () => {
  it('normalizes explicit codes to four characters', () => {
    expect(fourCharCode('ab', 'seed')).toBe('abxx');
    expect(fourCharCode('abcdef', 'seed')).toBe('abcd');
    expect(fourCharCode('Acme', 'seed')).toBe('Acme');
  });

  it('derives a stable code with exactly one leading upper-case letter', () => {
    const code = fourCharCode(undefined, 'com.acme.reverb');
    expect(code).toMatch(/^[A-Z][a-z0-9]{3}$/);
    expect(fourCharCode(undefined, 'com.acme.reverb')).toBe(code);
  });
});
