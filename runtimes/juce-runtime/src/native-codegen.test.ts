import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  describeNativeApi,
  type NativeApiDeclaration,
} from '@soundor/runtime-sdk';
import { describe, expect, it } from 'vitest';

import { generateNativeModuleSources } from './native-codegen';

/**
 * Exercises every supported shape. Its generated C++ is checked in under
 * engines/engine/tests/generated and compiled by the native test suite, which calls
 * each method from JavaScript. Regenerate with:
 *
 *   UPDATE_GOLDEN=1 pnpm --filter @soundor/juce-runtime test
 */
export const fixtureNativeApi: NativeApiDeclaration = {
  types: {
    Curve: { enum: ['linear', 'exponential', 'low-cut'] },
    Point: { struct: { x: 'float64', y: 'float64' } },
    Analysis: {
      struct: {
        rms: 'float32',
        peak: 'float32',
        label: 'string',
        clipped: 'boolean',
        curve: 'Curve',
        points: 'Point[]',
        tags: 'string[]',
      },
    },
    Preset: { struct: { name: 'string', gains: 'float32[]' } },
    Numbers: {
      struct: {
        i8: 'int8',
        u8: 'uint8',
        i16: 'int16',
        u16: 'uint16',
        i32: 'int32',
        u32: 'uint32',
        i64: 'int64',
        u64: 'uint64',
        f32: 'float32',
        f64: 'float64',
      },
    },
    Buffers: {
      struct: {
        i8: 'buffer<int8>',
        u8: 'buffer<uint8>',
        i16: 'buffer<int16>',
        u16: 'buffer<uint16>',
        i32: 'buffer<int32>',
        u32: 'buffer<uint32>',
        i64: 'buffer<int64>',
        u64: 'buffer<uint64>',
        f32: 'buffer<float32>',
        f64: 'buffer<float64>',
      },
    },
    Optionals: {
      struct: {
        slot: 'int32?',
        id: 'uint64?',
        name: 'string?',
        curve: 'Curve?',
        point: 'Point?',
        gains: 'float32[]?',
        samples: 'buffer<float32>?',
      },
    },
  },
  methods: {
    add: { args: { a: 'int32', b: 'int32' }, returns: 'int32' },
    greet: { args: { name: 'string' }, returns: 'string' },
    isEven: { args: { value: 'int32' }, returns: 'boolean' },
    echoUint8: { args: { value: 'uint8' }, returns: 'uint8' },
    echoInt64: { args: { value: 'int64' }, returns: 'int64' },
    echoUint64: { args: { value: 'uint64' }, returns: 'uint64' },
    echoFloat32: { args: { value: 'float32' }, returns: 'float32' },
    echoNumbers: { args: { numbers: 'Numbers' }, returns: 'Numbers' },
    echoBuffers: { args: { buffers: 'Buffers' }, returns: 'Buffers' },
    echoOptionals: { args: { optionals: 'Optionals' }, returns: 'Optionals' },
    analyze: { args: { samples: 'buffer<float32>' }, returns: 'Analysis' },
    getSpectrum: { returns: 'buffer<float32>' },
    sumBytes: { args: { data: 'buffer<uint8>' }, returns: 'uint32' },
    sumInts: { args: { values: 'buffer<int32>' }, returns: 'int64' },
    sumWords: { args: { values: 'buffer<uint64>?' }, returns: 'uint64?' },
    makeRamp: { args: { length: 'uint32' }, returns: 'buffer<float32>' },
    scale: {
      args: { values: 'buffer<float64>', factor: 'float64' },
      returns: 'buffer<float64>',
    },
    reverseBytes: {
      args: { data: 'buffer<uint8>' },
      returns: 'buffer<uint8>',
    },
    invert: { args: { curve: 'Curve' }, returns: 'Curve' },
    centroid: { args: { points: 'Point[]' }, returns: 'Point' },
    firstPoint: { args: { points: 'Point[]?' }, returns: 'Point?' },
    joinTags: { args: { tags: 'string[]' }, returns: 'string' },
    curves: { returns: 'Curve[]' },
    setSolo: { args: { slot: 'int32?' } },
    solo: { returns: 'int32?' },
    fail: { args: { message: 'string' } },
    loadPreset: { args: { path: 'string' }, returns: 'Preset?', async: true },
    applyPreset: { args: { preset: 'Preset' }, returns: 'void' },
    save: { args: { preset: 'Preset' }, async: true },
    reset: {},
  },
};

const goldenDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../engines/engine/tests/generated',
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
    expect(header).not.toMatch(/hermes|jsi::|quickjs|JSValue|JSContext/);
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
      'virtual std::int32_t add(std::int32_t a, std::int32_t b) = 0;',
    );
    expect(header).toContain(
      'virtual std::uint64_t echoUint64(std::uint64_t value) = 0;',
    );
    expect(header).toContain('virtual float echoFloat32(float value) = 0;');
    expect(header).toContain(
      'virtual std::optional<std::uint64_t> sumWords(std::optional<std::span<const std::uint64_t>> values) = 0;',
    );
    expect(header).toContain(
      'virtual Point centroid(std::vector<Point> points) = 0;',
    );
    expect(header).toContain(
      'virtual std::optional<Point> firstPoint(std::optional<std::vector<Point>> points) = 0;',
    );
    expect(header).toContain(
      'virtual void setSolo(std::optional<std::int32_t> slot) = 0;',
    );
    expect(header).toContain(
      'virtual void loadPreset(std::string path, js::Promise<std::optional<Preset>> promise) = 0;',
    );
    expect(header).toContain(
      'virtual void save(Preset preset, js::Promise<void> promise) = 0;',
    );
    expect(header).toContain('virtual void reset() = 0;');
    expect(header).toContain('        LowCut, // "low-cut"');
    expect(header).toContain('        std::vector<Point> points {};');
    expect(header).toContain('        std::vector<std::int64_t> i64 {};');
    expect(header).toContain(
      '        std::optional<std::vector<float>> samples {};',
    );
    expect(header).not.toMatch(/shared_ptr<(?!NativeApi)/);
  });

  it('generates an installable module for an empty API', () => {
    const [header, source] = generateNativeModuleSources({
      types: [],
      methods: [],
    });
    expect(header!.contents).toContain(
      'virtual ~NativeApi() = default;\n    };',
    );
    expect(source!.contents).toContain('[](bind::ContextState&, jsi::Object&)');
  });
});
