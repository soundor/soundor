import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { ConfigError } from '../errors';
import { parseConfig } from '../parse';
import { validateConfig } from '../schema';
import type { SoundorConfig } from '../types';

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../tests/fixtures',
);
const validConfig = resolve(fixtures, 'valid/soundor.config.ts');

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

const expected: SoundorConfig = {
  runtimes: [{ id: 'juce', options: { format: 'vst3' } }],
  parameters: [
    {
      type: 'float',
      id: 'gain',
      label: 'Gain',
      min: 0,
      max: 1,
      default: 0.5,
      unit: 'dB',
    },
    { type: 'int', id: 'voices', label: 'Voices', min: 1, max: 16, default: 4 },
    { type: 'bool', id: 'bypass', label: 'Bypass', default: false },
    {
      type: 'enum',
      id: 'mode',
      label: 'Mode',
      values: ['mono', 'stereo'],
      default: 'stereo',
    },
  ],
  nativeMethods: [{ name: 'render', input: 'Request', output: 'Result' }],
};

async function rejectsWith(fn: () => Promise<unknown>): Promise<ConfigError> {
  let caught: unknown;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConfigError);
  return caught as ConfigError;
}

describe('parseConfig — loading', () => {
  it('loads and normalizes a valid config', async () => {
    const config = await parseConfig({ path: validConfig });
    expect(config).toEqual(expected);
  });

  it('is deterministic: identical input yields identical output', async () => {
    const a = await parseConfig({ path: validConfig });
    const b = await parseConfig({ path: validConfig });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('applies defaults (options, nativeMethods) deterministically', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'soundor-'));
    cleanups.push(dir);
    const path = resolve(dir, 'soundor.config.ts');
    // Written outside the workspace: no imports, so no resolution needed.
    writeFileSync(
      path,
      `export default { runtimes: [{ id: 'juce' }], parameters: [] };`,
    );
    const config = await parseConfig({ path });
    expect(config).toEqual({
      runtimes: [{ id: 'juce', options: {} }],
      parameters: [],
      nativeMethods: [],
    });
  });

  it('discovers soundor.config.ts by walking up from cwd', async () => {
    const nested = resolve(fixtures, 'valid/deeply/nested');
    mkdirSync(nested, { recursive: true });
    cleanups.push(resolve(fixtures, 'valid/deeply'));
    const config = await parseConfig({ cwd: nested });
    expect(config).toEqual(expected);
  });

  it('throws not-found when no config exists up the tree', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'soundor-'));
    cleanups.push(dir);
    const error = await rejectsWith(() => parseConfig({ cwd: dir }));
    expect(error.kind).toBe('not-found');
    expect(error.message).toContain('soundor.config.ts');
  });

  it('throws load when the module has no default export', async () => {
    const error = await rejectsWith(() =>
      parseConfig({ path: resolve(fixtures, 'no-default/soundor.config.ts') }),
    );
    expect(error.kind).toBe('load');
  });

  it('throws load when the module fails to evaluate', async () => {
    const error = await rejectsWith(() =>
      parseConfig({ path: resolve(fixtures, 'broken/soundor.config.ts') }),
    );
    expect(error.kind).toBe('load');
  });

  it('surfaces validation errors end-to-end with structured issues', async () => {
    const error = await rejectsWith(() =>
      parseConfig({ path: resolve(fixtures, 'invalid/soundor.config.ts') }),
    );
    expect(error.kind).toBe('validation');
    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.format()).toContain('parameters');
  });
});

describe('validateConfig — validation rules', () => {
  const base = { runtimes: [], parameters: [] };

  it('accepts a valid config and normalizes it', () => {
    expect(validateConfig({ ...base, runtimes: [{ id: 'juce' }] })).toEqual({
      runtimes: [{ id: 'juce', options: {} }],
      parameters: [],
      nativeMethods: [],
    });
  });

  it('rejects a malformed shape (wrong field type)', () => {
    const error = expectValidation({
      ...base,
      parameters: [
        { type: 'float', id: 'g', label: 'G', min: 'x', max: 1, default: 0 },
      ],
    });
    expect(error.issues[0]?.path).toBe('parameters[0].min');
  });

  it('rejects an unknown parameter type', () => {
    const error = expectValidation({
      ...base,
      parameters: [{ type: 'ratio', id: 'g', label: 'G' }],
    });
    expect(error.issues.length).toBeGreaterThan(0);
  });

  it('flags min greater than max', () => {
    const error = expectValidation({
      ...base,
      parameters: [
        { type: 'int', id: 'n', label: 'N', min: 10, max: 1, default: 10 },
      ],
    });
    expect(error.issues).toContainEqual(
      expect.objectContaining({ path: 'parameters[0].min' }),
    );
  });

  it('flags a default out of range', () => {
    const error = expectValidation({
      ...base,
      parameters: [
        { type: 'float', id: 'g', label: 'G', min: 0, max: 1, default: 2 },
      ],
    });
    expect(error.issues).toContainEqual(
      expect.objectContaining({ path: 'parameters[0].default' }),
    );
  });

  it('flags an empty enum', () => {
    const error = expectValidation({
      ...base,
      parameters: [
        { type: 'enum', id: 'm', label: 'M', values: [], default: 'a' },
      ],
    });
    expect(error.issues).toContainEqual(
      expect.objectContaining({ path: 'parameters[0].values' }),
    );
  });

  it('flags an enum default that is not a declared value', () => {
    const error = expectValidation({
      ...base,
      parameters: [
        { type: 'enum', id: 'm', label: 'M', values: ['a', 'b'], default: 'c' },
      ],
    });
    expect(error.issues).toContainEqual(
      expect.objectContaining({ path: 'parameters[0].default' }),
    );
  });

  it('flags duplicate parameter and runtime ids', () => {
    const error = expectValidation({
      runtimes: [{ id: 'juce' }, { id: 'juce' }],
      parameters: [
        { type: 'bool', id: 'x', label: 'X', default: false },
        { type: 'bool', id: 'x', label: 'X2', default: true },
      ],
    });
    expect(error.issues).toContainEqual(
      expect.objectContaining({ path: 'runtimes[1].id' }),
    );
    expect(error.issues).toContainEqual(
      expect.objectContaining({ path: 'parameters[1].id' }),
    );
  });
});

function expectValidation(raw: unknown): ConfigError {
  let caught: unknown;
  try {
    validateConfig(raw);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConfigError);
  expect((caught as ConfigError).kind).toBe('validation');
  return caught as ConfigError;
}
