import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeNativeApi, type NativeApiDeclaration } from '@soundor/core';
import { describe, expect, it } from 'vitest';

import { generateNativeModuleSources } from './native-codegen';

/**
 * Exercises every supported shape. Its generated C++ is checked in under
 * native/tests/generated and compiled by the native test suite, which calls
 * each method from JavaScript. Regenerate with:
 *
 *   UPDATE_GOLDEN=1 pnpm --filter @soundor/juce-runtime test
 */
export const fixtureNativeApi: NativeApiDeclaration = {
  types: {
    Curve: { enum: ['linear', 'exponential', 'low-cut'] },
    Preset: 'handle',
    Point: { struct: { x: 'number', y: 'number' } },
    Analysis: {
      struct: {
        rms: 'number',
        peak: 'number',
        label: 'string',
        clipped: 'boolean',
        curve: 'Curve',
        points: 'Point[]',
        tags: 'string[]',
      },
    },
  },
  methods: {
    add: { args: { a: 'number', b: 'number' }, returns: 'number' },
    greet: { args: { name: 'string' }, returns: 'string' },
    isEven: { args: { value: 'number' }, returns: 'boolean' },
    analyze: { args: { samples: 'Float32Array' }, returns: 'Analysis' },
    sumBytes: { args: { data: 'ArrayBuffer' }, returns: 'number' },
    sumInts: { args: { values: 'Int32Array' }, returns: 'number' },
    makeRamp: { args: { length: 'number' }, returns: 'Float32Array' },
    makeBytes: { args: { count: 'number' }, returns: 'ArrayBuffer' },
    scale: {
      args: { values: 'Float64Array', factor: 'number' },
      returns: 'Float64Array',
    },
    reverseBytes: { args: { data: 'Uint8Array' }, returns: 'Uint8Array' },
    invert: { args: { curve: 'Curve' }, returns: 'Curve' },
    centroid: { args: { points: 'Point[]' }, returns: 'Point' },
    joinTags: { args: { tags: 'string[]' }, returns: 'string' },
    createPreset: { args: { name: 'string' }, returns: 'Preset' },
    presetName: { args: { preset: 'Preset' }, returns: 'string' },
    listPresets: { returns: 'Preset[]' },
    fail: { args: { message: 'string' } },
    loadPreset: { args: { name: 'string' }, returns: 'Preset', async: true },
    save: { args: { preset: 'Preset' }, async: true },
    reset: {},
  },
};

const goldenDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../native/tests/generated',
);

function modelOf(declaration: NativeApiDeclaration) {
  const result = describeNativeApi(declaration);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.model;
}

describe('generateNativeModuleSources', () => {
  const files = generateNativeModuleSources(modelOf(fixtureNativeApi));

  it('matches the golden files the native tests compile', () => {
    for (const file of files) {
      const target = join(goldenDir, file.path);
      if (process.env['UPDATE_GOLDEN'] === '1') {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.contents);
      }
      expect(existsSync(target), `${target} is missing`).toBe(true);
      expect(file.contents, `${file.path} is stale`).toBe(
        readFileSync(target, 'utf8'),
      );
    }
  });

  it('is deterministic regardless of declaration order', () => {
    const reversed: NativeApiDeclaration = {
      methods: Object.fromEntries(
        Object.entries(fixtureNativeApi.methods!).reverse(),
      ),
      types: Object.fromEntries(
        Object.entries(fixtureNativeApi.types!).reverse(),
      ),
    };
    expect(generateNativeModuleSources(modelOf(reversed))).toEqual(files);
  });

  it('keeps engine headers out of the public header', () => {
    const header = files.find((file) => file.path.endsWith('.h'))!.contents;
    expect(header).not.toMatch(/quickjs|JSValue|JSContext/);
    expect(header).toContain(
      'namespace soundor::inline SOUNDOR_ABI_NAMESPACE::native',
    );
  });

  it('maps the contract onto C++ signatures', () => {
    const header = files.find((file) => file.path.endsWith('.h'))!.contents;
    expect(header).toContain(
      'virtual Analysis analyze(std::span<const float> samples) = 0;',
    );
    expect(header).toContain(
      'virtual std::vector<double> scale(std::span<const double> values, double factor) = 0;',
    );
    expect(header).toContain(
      'virtual Point centroid(std::vector<Point> points) = 0;',
    );
    expect(header).toContain(
      'virtual void loadPreset(std::string name, js::Promise<std::shared_ptr<Preset>> promise) = 0;',
    );
    expect(header).toContain(
      'virtual void save(std::shared_ptr<Preset> preset, js::Promise<void> promise) = 0;',
    );
    expect(header).toContain('virtual void reset() = 0;');
    expect(header).toContain('        LowCut, // "low-cut"');
    expect(header).toContain('        std::vector<Point> points {};');
  });

  it('generates an installable module for an empty API', () => {
    const [header, source] = generateNativeModuleSources({
      types: [],
      methods: [],
    });
    expect(header!.contents).toContain(
      'virtual ~NativeApi() = default;\n    };',
    );
    expect(source!.contents).toContain('return true;');
  });
});
