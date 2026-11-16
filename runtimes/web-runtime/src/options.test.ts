import { describe, expect, it } from 'vitest';

import { resolveWebOptions } from './options';

describe('resolveWebOptions', () => {
  it('defaults the dev server port', () => {
    expect(resolveWebOptions({})).toEqual({ port: 5173 });
    expect(resolveWebOptions({ port: 0 })).toEqual({ port: 0 });
  });

  it.each([-1, 65536, 1.5, Number.NaN])('rejects port %s', (port) => {
    expect(() => resolveWebOptions({ port })).toThrow(
      expect.objectContaining({
        code: 'CONFIG',
        issues: [expect.objectContaining({ path: 'runtimes.web.port' })],
      }),
    );
  });
});

it('preserves replacement semantics and a browser path without executing it', () => {
  expect(resolveWebOptions({}).inputs).toBeUndefined();
  expect(resolveWebOptions({ inputs: [] }).inputs).toEqual([]);
  expect(resolveWebOptions({ inputs: './anywhere/inputs.ts' }).inputs).toBe(
    './anywhere/inputs.ts',
  );
  const inputs = [
    { type: 'oscillator', frequency: 440, gain: 0, waveform: 'square' },
    { type: 'microphone' },
    { type: 'file' },
  ] as const;
  expect(resolveWebOptions({ inputs }).inputs).toEqual(inputs);
});

it.each([
  '',
  [{ type: 'unknown' }],
  [{ type: 'file' }, { type: 'file' }],
  [{ type: 'oscillator', frequency: -1 }],
  [{ type: 'oscillator', gain: 2 }],
  [{ type: 'oscillator', waveform: 'custom' }],
  [{ type: 'microphone', typo: true }],
  null,
])('rejects invalid explicit inputs %j', (inputs) => {
  expect(() => resolveWebOptions({ inputs } as never)).toThrow(
    /Invalid webRuntime\(\) inputs/,
  );
});
