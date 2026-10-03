import { describe, expect, it } from 'vitest';

import { fourCharCode, resolveJuceOptions } from './options';

const plugin = { id: 'com.acme.reverb', name: 'Acme Reverb' };

describe('resolveJuceOptions', () => {
  it('derives every JUCE identity from the plugin', () => {
    const resolved = resolveJuceOptions({}, plugin);
    expect(resolved).toEqual({
      jucePath: undefined,
      formats: ['vst3'],
      bundleId: 'com.acme.reverb',
      pluginName: 'Acme Reverb',
      companyName: 'acme',
      pluginCode: fourCharCode(undefined, 'com.acme.reverb'),
      manufacturerCode: fourCharCode(undefined, 'com.acme'),
    });
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
