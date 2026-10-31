import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { resolveEditor } from '../editor';
import { ConfigError } from '../errors';
import { parseConfig } from '../parse';
import type { Runtime } from '../runtime';
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

/** A structurally-valid runtime for driving validation in unit tests. */
function makeRuntime(id: string): Runtime {
  const noop = async (): Promise<void> => {};
  return {
    id,
    init: noop,
    gen: noop,
    dev: noop,
    build: noop,
    doctor: async () => ({ checks: [] }),
  };
}

/** The serializable projection of a config (drops the live `runtime`). */
function projectData(config: SoundorConfig): unknown {
  return {
    plugin: config.plugin,
    runtimes: config.runtimes.map((r) => ({ id: r.id, options: r.options })),
    parameters: config.parameters,
    native: config.native,
  };
}

/** Expected serializable projection of the `valid` fixture. */
const expectedData = {
  plugin: { id: 'com.example.valid', name: 'Valid' },
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
  native: {
    methods: { render: { args: { request: 'string' }, returns: 'number' } },
  },
};

/** Asserts a parsed config carries a live runtime implementation for `id`. */
function expectRuntime(config: SoundorConfig, id: string): void {
  const runtime = config.runtimes.find((r) => r.id === id)?.runtime;
  expect(runtime?.id).toBe(id);
  for (const method of ['init', 'gen', 'dev', 'build', 'doctor'] as const) {
    expect(typeof runtime?.[method]).toBe('function');
  }
}

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
    expect(projectData(config)).toEqual(expectedData);
    expectRuntime(config, 'juce');
  });

  it('is deterministic: identical input yields identical output', async () => {
    const a = await parseConfig({ path: validConfig });
    const b = await parseConfig({ path: validConfig });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('applies defaults (options, native) deterministically', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'soundor-'));
    cleanups.push(dir);
    const path = resolve(dir, 'soundor.config.ts');
    // Written outside the workspace: no imports, so no resolution needed. The
    // runtime is defined inline so the entry is structurally valid.
    writeFileSync(
      path,
      `const noop = async () => {};
       const runtime = { id: 'juce', init: noop, gen: noop, dev: noop, build: noop, doctor: async () => ({ checks: [] }) };
       export default { plugin: { id: 'com.example.defaults', name: ' Defaults ' }, runtimes: [{ id: 'juce', runtime }], parameters: [] };`,
    );
    const config = await parseConfig({ path });
    expect(projectData(config)).toEqual({
      plugin: { id: 'com.example.defaults', name: 'Defaults' },
      runtimes: [{ id: 'juce', options: {} }],
      parameters: [],
      native: {},
    });
    expectRuntime(config, 'juce');
  });

  it('discovers soundor.config.ts by walking up from cwd', async () => {
    const nested = resolve(fixtures, 'valid/deeply/nested');
    mkdirSync(nested, { recursive: true });
    cleanups.push(resolve(fixtures, 'valid/deeply'));
    const config = await parseConfig({ cwd: nested });
    expect(projectData(config)).toEqual(expectedData);
    expectRuntime(config, 'juce');
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
  const plugin = { id: 'com.example.test', name: 'Test' };
  const base = { plugin, runtimes: [], parameters: [] };

  it('accepts a valid config and normalizes it', () => {
    const runtime = makeRuntime('juce');
    expect(
      validateConfig({ ...base, runtimes: [{ id: 'juce', runtime }] }),
    ).toEqual({
      plugin,
      editor: {
        width: 800,
        height: 600,
        minWidth: 800,
        minHeight: 600,
        maxWidth: 800,
        maxHeight: 600,
        resizable: false,
      },
      runtimes: [{ id: 'juce', options: {}, runtime }],
      parameters: [],
      native: {},
      signing: {},
    });
  });

  it('rejects a runtime entry with no implementation', () => {
    const error = expectValidation({ ...base, runtimes: [{ id: 'juce' }] });
    expect(error.issues).toContainEqual(
      expect.objectContaining({ path: 'runtimes[0].runtime' }),
    );
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

  it('requires a reverse-DNS plugin id and a display name', () => {
    for (const id of ['acme', 'com..acme', 'com.acme reverb', '']) {
      const error = expectValidation({ ...base, plugin: { id, name: 'X' } });
      expect(error.issues).toContainEqual(
        expect.objectContaining({ path: 'plugin.id' }),
      );
    }
    const unnamed = expectValidation({
      ...base,
      plugin: { ...plugin, name: ' ' },
    });
    expect(unnamed.issues).toContainEqual(
      expect.objectContaining({ path: 'plugin.name' }),
    );
    const missing = expectValidation({ runtimes: [], parameters: [] });
    expect(missing.issues).toContainEqual(
      expect.objectContaining({ path: 'plugin' }),
    );
  });

  it('reports native API issues with their config paths', () => {
    const error = expectValidation({
      ...base,
      native: {
        types: { Point: { struct: { x: 'number' } } },
        methods: { move: { args: { to: 'Pointt' } }, delete: {} },
      },
    });
    expect(error.issues.map((issue) => issue.path)).toEqual([
      'native.methods.delete',
      'native.methods.move.args.to',
    ]);
  });

  it('keeps a valid native API as declared', () => {
    const native = {
      types: { Preset: 'handle' },
      methods: {
        load: { args: { path: 'string' }, returns: 'Preset', async: true },
      },
    };
    expect(validateConfig({ ...base, native }).native).toEqual(native);
  });

  it('keeps a macOS signing identity, trimmed', () => {
    const identity = 'Developer ID Application: Acme (ABCDE12345)';
    expect(
      validateConfig({
        ...base,
        signing: { macos: { identity: ` ${identity} ` } },
      }).signing,
    ).toEqual({ macos: { identity } });
  });

  it('rejects a signing identity that looks like key material', () => {
    const error = expectValidation({
      ...base,
      signing: {
        macos: { identity: '-----BEGIN PRIVATE KEY-----\nMIIE...\n' },
      },
    });
    expect(error.issues).toContainEqual(
      expect.objectContaining({
        path: 'signing.macos.identity',
        message: expect.stringContaining('looks like key material'),
      }),
    );
    expect(
      expectValidation({ ...base, signing: { macos: { identity: ' ' } } })
        .issues,
    ).toContainEqual(
      expect.objectContaining({ path: 'signing.macos.identity' }),
    );
  });

  it('flags duplicate parameter and runtime ids', () => {
    const error = expectValidation({
      plugin,
      runtimes: [
        { id: 'juce', runtime: makeRuntime('juce') },
        { id: 'juce', runtime: makeRuntime('juce') },
      ],
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

describe('validateConfig — editor', () => {
  const base = {
    plugin: { id: 'com.example.test', name: 'Test' },
    runtimes: [],
    parameters: [],
  };

  it('opens a fixed editor at its size, its limits being that size', () => {
    expect(
      validateConfig({ ...base, editor: { width: 640, height: 400 } }).editor,
    ).toEqual({
      width: 640,
      height: 400,
      minWidth: 640,
      minHeight: 400,
      maxWidth: 640,
      maxHeight: 400,
      resizable: false,
    });
  });

  it('gives a resizable editor default limits around its size', () => {
    expect(
      validateConfig({ ...base, editor: { resizable: true } }).editor,
    ).toEqual({
      width: 800,
      height: 600,
      minWidth: 480,
      minHeight: 320,
      maxWidth: 1600,
      maxHeight: 1200,
      resizable: true,
    });
    // Default limits never exclude the size it opens at.
    expect(
      validateConfig({
        ...base,
        editor: { width: 300, height: 2000, resizable: true },
      }).editor,
    ).toMatchObject({
      minWidth: 300,
      maxWidth: 1600,
      minHeight: 320,
      maxHeight: 2000,
    });
  });

  it('keeps explicit limits, and resolving again changes nothing', () => {
    const editor = {
      width: 900,
      height: 500,
      minWidth: 600,
      minHeight: 400,
      maxWidth: 1800,
      maxHeight: 1000,
      resizable: true,
    };
    const resolved = validateConfig({ ...base, editor }).editor;
    expect(resolved).toEqual(editor);
    expect(validateConfig({ ...base, editor: resolved }).editor).toEqual(
      resolved,
    );
    expect(resolveEditor(resolved)).toEqual(resolved);
  });

  it('ignores the limits of a fixed editor', () => {
    expect(
      validateConfig({
        ...base,
        editor: { width: 700, minWidth: 900, maxWidth: 1000 },
      }).editor,
    ).toMatchObject({ width: 700, minWidth: 700, maxWidth: 700 });
  });

  it.each([
    ['width', 0, 'positive'],
    ['height', -10, 'positive'],
    ['minWidth', 480.5, 'whole number'],
    ['maxHeight', Number.POSITIVE_INFINITY, ''],
    ['width', Number.NaN, ''],
  ])('rejects %s = %s', (key, value, message) => {
    const error = expectValidation({
      ...base,
      editor: { resizable: true, [key]: value },
    });
    expect(error.issues).toContainEqual(
      expect.objectContaining({
        path: `editor.${key}`,
        message: expect.stringContaining(message),
      }),
    );
  });

  it('rejects a non-boolean resizable', () => {
    expect(
      expectValidation({ ...base, editor: { resizable: 'yes' } }).issues,
    ).toContainEqual(expect.objectContaining({ path: 'editor.resizable' }));
  });

  it('rejects a minimum over its maximum', () => {
    const error = expectValidation({
      ...base,
      editor: { minWidth: 900, maxWidth: 600, minHeight: 700, maxHeight: 500 },
    });
    expect(error.issues).toEqual([
      {
        path: 'editor.minWidth',
        message: 'minWidth (900) must be <= maxWidth (600)',
      },
      {
        path: 'editor.minHeight',
        message: 'minHeight (700) must be <= maxHeight (500)',
      },
    ]);
  });

  it('rejects a resizable editor opening outside its limits', () => {
    const error = expectValidation({
      ...base,
      editor: {
        width: 400,
        minWidth: 480,
        height: 1300,
        maxHeight: 1200,
        resizable: true,
      },
    });
    expect(error.issues).toEqual([
      {
        path: 'editor.width',
        message:
          'width (400) is outside the resize limits; set it within [480, 1600]',
      },
      {
        path: 'editor.height',
        message:
          'height (1300) is outside the resize limits; set it within [320, 1200]',
      },
    ]);
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
