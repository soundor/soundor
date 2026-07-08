import { describe, expect, it } from 'vitest';

import { resolveJuceOptions } from './options';

describe('resolveJuceOptions', () => {
  it('applies defaults for an empty options bag', () => {
    const resolved = resolveJuceOptions({});
    expect(resolved).toEqual({
      jucePath: undefined,
      formats: ['vst3'],
      pluginName: 'SoundorPlugin',
      companyName: 'Soundor',
      pluginCode: 'Sndr',
      manufacturerCode: 'Sndo',
    });
  });

  it('keeps explicit formats and identifiers', () => {
    const resolved = resolveJuceOptions({
      plugin: {
        formats: ['vst3', 'au'],
        pluginName: 'My Synth',
      },
    });
    expect(resolved.formats).toEqual(['vst3', 'au']);
    expect(resolved.pluginName).toBe('My Synth');
  });

  it('falls back when formats is empty', () => {
    expect(resolveJuceOptions({ plugin: { formats: [] } }).formats).toEqual([
      'vst3',
    ]);
  });

  it('normalizes plugin/manufacturer codes to four characters', () => {
    expect(
      resolveJuceOptions({ plugin: { pluginCode: 'ab' } }).pluginCode,
    ).toBe('abxx');
    expect(
      resolveJuceOptions({ plugin: { pluginCode: 'abcdef' } }).pluginCode,
    ).toBe('abcd');
    expect(
      resolveJuceOptions({ plugin: { manufacturerCode: 'Acme' } })
        .manufacturerCode,
    ).toBe('Acme');
  });
});
