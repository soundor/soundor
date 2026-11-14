import { describe, expect, it } from 'vitest';

import { resolveConfig, initialBusLayout } from '../index';

const plugin = { id: 'com.acme.effect', name: 'Effect' };
const audio = {
  buses: {
    input: { direction: 'input', name: 'Input' },
    output: { direction: 'output', name: 'Output' },
    sidechain: { direction: 'input', name: 'Sidechain', optional: true },
  },
  layouts: {
    stereo: {
      input: 'stereo',
      output: 'stereo',
      sidechain: ['disabled', 'mono'],
    },
  },
  defaultLayout: 'stereo',
  defaultBuses: { sidechain: 'disabled' },
};
const resolve = (extra: object) =>
  resolveConfig({ plugin, runtimes: [], ...extra });

describe('audio contract', () => {
  it('retains legacy audio ownership unless explicitly declared', () => {
    expect(resolve({}).audio).toBeUndefined();
  });
  it('retains complete layouts and explicit initial optional bus selections', () => {
    const result = resolve({ audio });
    expect(result.audio).toEqual(audio);
    expect(initialBusLayout(result.audio!, 'sidechain')).toBe('disabled');
  });
  it.each([
    { ...audio, defaultLayout: 'mono' },
    { ...audio, defaultBuses: {} },
    { ...audio, defaultBuses: { sidechain: 'stereo' } },
    { ...audio, layouts: { stereo: { input: 'stereo', output: 'stereo' } } },
    {
      ...audio,
      layouts: { stereo: { ...audio.layouts.stereo, input: 'disabled' } },
    },
    {
      ...audio,
      layouts: { stereo: { ...audio.layouts.stereo, unknown: 'mono' } },
    },
    { ...audio, latency: { mode: 'fixed', samples: -1 } },
    { ...audio, tail: { mode: 'fixed', seconds: Infinity } },
  ])('rejects invalid references and processing metadata %#', (audio) => {
    expect(() => resolve({ audio })).toThrow('Invalid Soundor config');
  });
  it('validates parameter group references and a single writable boolean bypass', () => {
    const config = {
      parameterGroups: { output: { label: 'Output' } },
      parameters: {
        bypass: {
          type: 'boolean',
          default: false,
          group: 'output',
          role: 'bypass',
        },
      },
    };
    expect(resolve(config).parameters[0]).toMatchObject({
      group: 'output',
      role: 'bypass',
    });
    expect(() => resolve({ ...config, parameterGroups: {} })).toThrow(
      'Invalid Soundor config',
    );
    expect(() =>
      resolve({
        parameters: { ...config.parameters, other: config.parameters.bypass },
        parameterGroups: config.parameterGroups,
      }),
    ).toThrow('Invalid Soundor config');
    expect(() =>
      resolve({
        parameters: {
          bypass: {
            type: 'boolean',
            default: false,
            access: 'readOnly',
            role: 'bypass',
          },
        },
      }),
    ).toThrow('Invalid Soundor config');
  });
  it('preserves and validates plugin metadata', () => {
    const metadata = {
      ...plugin,
      kind: 'instrument',
      categories: ['sampler'],
      vendor: {
        name: 'Acme',
        website: 'https://acme.example',
        supportEmail: 'support@acme.example',
      },
      copyright: 'Acme',
    };
    expect(resolve({ plugin: metadata }).plugin).toEqual({
      ...metadata,
      version: '0.1.0',
    });
    expect(() =>
      resolve({ plugin: { ...metadata, kind: ['effect', 'instrument'] } }),
    ).toThrow('Invalid Soundor config');
  });
});
