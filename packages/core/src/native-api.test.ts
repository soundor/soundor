import { describe, expect, it } from 'vitest';

import {
  describeNativeApi,
  enumeratorName,
  type NativeApiDeclaration,
} from './native-api';
import { renderNativeDts } from './native-dts';

function issuesOf(declaration: NativeApiDeclaration): string[] {
  const result = describeNativeApi(declaration);
  if (result.ok) throw new Error('expected validation to fail');
  return result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

function modelOf(declaration: NativeApiDeclaration) {
  const result = describeNativeApi(declaration);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.model;
}

describe('describeNativeApi', () => {
  it('accepts an absent or empty declaration', () => {
    expect(modelOf({})).toEqual({ types: [], methods: [], events: [] });
    expect(describeNativeApi(undefined)).toEqual({
      ok: true,
      model: { types: [], methods: [], events: [] },
    });
  });

  it('resolves every kind of type reference', () => {
    const model = modelOf({
      types: {
        Curve: { enum: ['linear', 'exponential'] },
        Point: { struct: { x: 'float64', y: 'float64' } },
      },
      methods: {
        everything: {
          args: {
            flag: 'boolean',
            label: 'string',
            small: 'int8',
            count: 'uint32',
            big: 'int64',
            gain: 'float32',
            samples: 'buffer<float32>',
            words: 'buffer<uint64>',
            curve: 'Curve',
            points: 'Point[]',
            names: 'string[]',
            slot: 'int32?',
            point: 'Point?',
            gains: 'float32[]?',
            spectrum: 'buffer<float64>?',
          },
          returns: 'Point[]',
          async: true,
        },
      },
    });
    const [method] = model.methods;
    expect(method!.async).toBe(true);
    const point = { kind: 'declared', name: 'Point', declaration: 'struct' };
    expect(method!.args.map((arg) => [arg.name, arg.type])).toEqual([
      ['flag', { kind: 'primitive', name: 'boolean' }],
      ['label', { kind: 'primitive', name: 'string' }],
      ['small', { kind: 'primitive', name: 'int8' }],
      ['count', { kind: 'primitive', name: 'uint32' }],
      ['big', { kind: 'primitive', name: 'int64' }],
      ['gain', { kind: 'primitive', name: 'float32' }],
      ['samples', { kind: 'buffer', element: 'float32' }],
      ['words', { kind: 'buffer', element: 'uint64' }],
      ['curve', { kind: 'declared', name: 'Curve', declaration: 'enum' }],
      ['points', { kind: 'array', element: point }],
      [
        'names',
        { kind: 'array', element: { kind: 'primitive', name: 'string' } },
      ],
      [
        'slot',
        { kind: 'nullable', inner: { kind: 'primitive', name: 'int32' } },
      ],
      ['point', { kind: 'nullable', inner: point }],
      [
        'gains',
        {
          kind: 'nullable',
          inner: {
            kind: 'array',
            element: { kind: 'primitive', name: 'float32' },
          },
        },
      ],
      [
        'spectrum',
        { kind: 'nullable', inner: { kind: 'buffer', element: 'float64' } },
      ],
    ]);
    expect(method!.returns).toEqual({ kind: 'array', element: point });
  });

  it('accepts every primitive, and buffers of every numeric type', () => {
    const numeric = [
      'int8',
      'uint8',
      'int16',
      'uint16',
      'int32',
      'uint32',
      'int64',
      'uint64',
      'float32',
      'float64',
    ];
    const model = modelOf({
      types: {
        Everything: {
          struct: Object.fromEntries([
            ['flag', 'boolean'],
            ['text', 'string'],
            ...numeric.map((name) => [`${name}Value`, name]),
            ...numeric.map((name) => [`${name}Buffer`, `buffer<${name}>`]),
          ]),
        },
      },
    });
    expect(model.types[0]!.kind).toBe('struct');
  });

  it('keeps argument order and defaults returns to void', () => {
    const model = modelOf({
      methods: { mix: { args: { b: 'int32', a: 'int32' } } },
    });
    expect(model.methods[0]!.args.map((arg) => arg.name)).toEqual(['b', 'a']);
    expect(model.methods[0]!.returns).toEqual({ kind: 'void' });
    expect(model.methods[0]!.async).toBe(false);
  });

  it('sorts methods and orders structs after the structs they contain', () => {
    const model = modelOf({
      types: {
        Outer: { struct: { inner: 'Inner', list: 'Leaf[]' } },
        Inner: { struct: { leaf: 'Leaf' } },
        Leaf: { struct: { value: 'float64' } },
        Alpha: { enum: ['a'] },
      },
      methods: { zeta: {}, alpha: {} },
    });
    expect(model.types.map((type) => type.name)).toEqual([
      'Alpha',
      'Leaf',
      'Inner',
      'Outer',
    ]);
    expect(model.methods.map((method) => method.name)).toEqual([
      'alpha',
      'zeta',
    ]);
  });

  it('reports unknown types and misplaced void with their paths', () => {
    expect(
      issuesOf({
        methods: {
          broken: { args: { a: 'Widget', b: 'void' }, returns: 'Missing' },
        },
      }),
    ).toEqual([
      expect.stringMatching(
        /^native\.methods\.broken\.args\.a: unknown type 'Widget'/,
      ),
      "native.methods.broken.args.b: 'void' is only valid as a return type",
      expect.stringMatching(
        /^native\.methods\.broken\.returns: unknown type 'Missing'/,
      ),
    ]);
  });

  it('rejects names that cannot be generated', () => {
    expect(
      issuesOf({
        types: {
          lowercase: { enum: ['a'] },
          Promise: { enum: ['a'] },
          Float32Array: { enum: ['a'] },
        },
        methods: {
          delete: {},
          'not-an-identifier': {},
          __internal: {},
          Upper: {},
          ok: { args: { class: 'int32' } },
        },
      }),
    ).toEqual([
      "native.types.Float32Array: type name 'Float32Array' collides with a built-in type",
      "native.types.Promise: type name 'Promise' collides with a built-in type",
      expect.stringContaining(
        "native.types.lowercase: type name 'lowercase' must be PascalCase",
      ),
      expect.stringContaining(
        "native.methods.Upper: method name 'Upper' must be camelCase",
      ),
      expect.stringContaining(
        "native.methods.__internal: method name '__internal' must be camelCase",
      ),
      "native.methods.delete: method name 'delete' is reserved in JavaScript, C++ or generated code",
      expect.stringContaining(
        "native.methods.not-an-identifier: method name 'not-an-identifier' must be camelCase",
      ),
      "native.methods.ok.args.class: argument name 'class' is reserved in JavaScript, C++ or generated code",
    ]);
  });

  it('rejects handles, unsupported compositions and recursion', () => {
    expect(
      issuesOf({
        types: {
          Preset: 'handle' as never,
          Loop: { struct: { next: 'Loop?' } },
        },
        methods: {
          grid: { returns: 'float32[][]' },
          holes: { args: { values: 'int32?[]' } },
          buffers: { args: { list: 'buffer<uint8>[]' } },
          twice: { args: { value: 'int32??' } },
          nothing: { returns: 'void?' },
          text: { args: { data: 'buffer<string>' } },
          nested: { args: { data: 'buffer<buffer<uint8>>' } },
          flags: { args: { data: 'buffer<boolean>' } },
          points: { args: { data: 'buffer<Loop>' } },
        },
      }),
    ).toEqual([
      "native.types.Preset: 'handle' types are gone: declare a { struct: { ... } } of the values the UI needs, or pass an ID or path",
      expect.stringContaining(
        "native.types.Loop: struct 'Loop' contains itself (Loop → Loop)",
      ),
      expect.stringContaining(
        "native.methods.buffers.args.list: 'buffer<uint8>[]' is not supported",
      ),
      expect.stringContaining(
        "native.methods.flags.args.data: 'buffer<boolean>' is not supported; a buffer holds one fixed-width numeric type",
      ),
      expect.stringContaining(
        "native.methods.grid.returns: 'float32[][]' is not supported",
      ),
      expect.stringContaining(
        "native.methods.holes.args.values: 'int32?[]' is not supported",
      ),
      expect.stringContaining(
        "native.methods.nested.args.data: 'buffer<buffer<uint8>>' is not supported",
      ),
      expect.stringContaining(
        "native.methods.nothing.returns: 'void?' is not supported",
      ),
      expect.stringContaining(
        "native.methods.points.args.data: 'buffer<Loop>' is not supported",
      ),
      expect.stringContaining(
        "native.methods.text.args.data: 'buffer<string>' is not supported",
      ),
      expect.stringContaining(
        "native.methods.twice.args.value: 'int32??' is not supported",
      ),
    ]);
  });

  it('points former type names to their replacements', () => {
    expect(
      issuesOf({
        methods: {
          a: { args: { value: 'number' } },
          b: { args: { data: 'Float32Array' } },
          c: { args: { data: 'ArrayBuffer' } },
          d: { args: { data: 'BigInt64Array[]' } },
          e: { args: { value: 'float' } },
        },
      }),
    ).toEqual([
      "native.methods.a.args.value: 'number' is not a native type; use a sized number ('int32', 'float64', ...)",
      "native.methods.b.args.data: 'Float32Array' is not a native type; use 'buffer<float32>'",
      "native.methods.c.args.data: 'ArrayBuffer' is not a native type; use 'buffer<uint8>'",
      "native.methods.d.args.data: 'BigInt64Array' is not a native type; use 'buffer<int64>'",
      expect.stringMatching(
        /^native\.methods\.e\.args\.value: unknown type 'float'/,
      ),
    ]);
  });

  it('rejects enums whose values collide as C++ enumerators', () => {
    expect(
      issuesOf({
        types: {
          Empty: { enum: [] },
          Clash: { enum: ['low-cut', 'low_cut', 'low-cut'] },
        },
      }),
    ).toEqual([
      "native.types.Clash.enum[1]: enum values 'low-cut' and 'low_cut' map to the same C++ enumerator 'LowCut'",
      "native.types.Clash.enum[2]: duplicate enum value 'low-cut'",
      'native.types.Empty.enum: expected a non-empty array of strings',
    ]);
  });
});

describe('native events', () => {
  it('resolves events, sorted, with their fields in order', () => {
    const model = modelOf({
      types: { Preset: { struct: { name: 'string' } } },
      events: {
        presetLoaded: { path: 'string', preset: 'Preset?' },
        error: { message: 'string', code: 'int32' },
        ready: {},
      },
    });
    expect(model.events).toEqual([
      {
        name: 'error',
        fields: [
          { name: 'message', type: { kind: 'primitive', name: 'string' } },
          { name: 'code', type: { kind: 'primitive', name: 'int32' } },
        ],
      },
      {
        name: 'presetLoaded',
        fields: [
          { name: 'path', type: { kind: 'primitive', name: 'string' } },
          {
            name: 'preset',
            type: {
              kind: 'nullable',
              inner: {
                kind: 'declared',
                name: 'Preset',
                declaration: 'struct',
              },
            },
          },
        ],
      },
      { name: 'ready', fields: [] },
    ]);
  });

  it('reports bad events with their paths', () => {
    expect(
      issuesOf({
        methods: { events: {} },
        events: {
          Loaded: {},
          done: { value: 'void' },
          moved: { to: 'Point' },
          broken: 'string' as never,
          class: {},
          publish: {},
        },
      }),
    ).toEqual([
      "native.methods.events: method name 'events' is taken by soundor:native's own 'events' export",
      "native.events.Loaded: event name 'Loaded' must be camelCase (start with a lowercase letter; letters, digits and _)",
      'native.events.broken: expected an object mapping field names to types',
      "native.events.class: event name 'class' is reserved in JavaScript, C++ or generated code",
      "native.events.done.value: 'void' is only valid as a return type",
      "native.events.moved.to: unknown type 'Point'; use boolean, string, int8, uint8, int16, uint16, int32, uint32, int64, uint64, float32, float64, a type declared in native.types, 'T[]', 'buffer<T>' or 'T?'",
      "native.events.publish: event name 'publish' is taken by the generated C++ publisher",
    ]);
    expect(issuesOf({ events: [] as never })).toEqual([
      'native.events: expected an object mapping event names to their fields',
    ]);
    expect(
      issuesOf({
        types: { PresetLoaded: { struct: { path: 'string' } } },
        events: { presetLoaded: { preset: 'PresetLoaded' } },
      }),
    ).toEqual([
      "native.events.presetLoaded: event 'presetLoaded' collides with the type 'PresetLoaded' (its value is the C++ struct events::PresetLoaded); rename one of them",
    ]);
    expect(issuesOf({ types: { NativeEvent: { enum: ['a'] } } })).toEqual([
      "native.types.NativeEvent: type name 'NativeEvent' collides with a built-in type",
    ]);
  });

  it('declares events, only when there are some', () => {
    const dts = renderNativeDts(
      modelOf({
        events: {
          presetLoaded: { path: 'string', gains: 'float32[]' },
          ready: {},
        },
      }),
    );
    expect(dts).toContain('  export interface NativeEvent<T> {');
    expect(dts).toContain(
      '    subscribe(listener: (event: T) => void): () => void;',
    );
    expect(dts).toContain(
      '  export const events: {\n    readonly presetLoaded: NativeEvent<{ path: string; gains: number[] }>;\n    readonly ready: NativeEvent<Record<string, never>>;\n  };',
    );
    expect(renderNativeDts(modelOf({ methods: { f: {} } }))).not.toContain(
      'events',
    );
  });
});

describe('enumeratorName', () => {
  it('derives PascalCase C++ enumerators', () => {
    expect(enumeratorName('linear')).toBe('Linear');
    expect(enumeratorName('low-cut')).toBe('LowCut');
    expect(enumeratorName('48k')).toBe('Value48k');
    expect(enumeratorName('---')).toBe('Value');
  });
});

describe('renderNativeDts', () => {
  it('declares an empty module for an empty API', () => {
    expect(renderNativeDts({ types: [], methods: [], events: [] })).toBe(
      "// This file was generated by Soundor. Do not edit.\n\ndeclare module 'soundor:native' {\n}\n",
    );
  });

  it('declares enums, structs, async results and readonly array arguments', () => {
    const dts = renderNativeDts(
      modelOf({
        types: {
          Curve: { enum: ['linear', 'exponential'] },
          Point: { struct: { x: 'float64', tags: 'string[]', id: 'uint64?' } },
        },
        methods: {
          load: { args: { path: 'string' }, returns: 'Point?', async: true },
          plot: {
            args: { points: 'Point[]', curve: 'Curve', gains: 'float32[]?' },
            returns: 'float64[]',
          },
        },
      }),
    );
    expect(dts).toContain('  export type Curve = "linear" | "exponential";');
    expect(dts).toContain(
      '  export interface Point {\n    x: number;\n    tags: string[];\n    id: bigint | null;\n  }',
    );
    expect(dts).toContain(
      '  export function load(path: string): Promise<Point | null>;',
    );
    expect(dts).toContain(
      '  export function plot(points: readonly Point[], curve: Curve, gains: readonly number[] | null): number[];',
    );
  });

  it('maps numbers to number or bigint, and buffers to typed arrays', () => {
    const types: [string, string][] = [
      ['int8', 'number'],
      ['uint8', 'number'],
      ['int16', 'number'],
      ['uint16', 'number'],
      ['int32', 'number'],
      ['uint32', 'number'],
      ['int64', 'bigint'],
      ['uint64', 'bigint'],
      ['float32', 'number'],
      ['float64', 'number'],
      ['buffer<int8>', 'Int8Array'],
      ['buffer<uint8>', 'Uint8Array'],
      ['buffer<int16>', 'Int16Array'],
      ['buffer<uint16>', 'Uint16Array'],
      ['buffer<int32>', 'Int32Array'],
      ['buffer<uint32>', 'Uint32Array'],
      ['buffer<int64>', 'BigInt64Array'],
      ['buffer<uint64>', 'BigUint64Array'],
      ['buffer<float32>', 'Float32Array'],
      ['buffer<float64>', 'Float64Array'],
      ['buffer<float32>?', 'Float32Array | null'],
    ];
    const dts = renderNativeDts(
      modelOf({
        methods: Object.fromEntries(
          types.map(([ref], index) => [
            `m${index}`,
            { args: { value: ref }, returns: ref },
          ]),
        ),
      }),
    );
    types.forEach(([, ts], index) => {
      expect(dts).toContain(
        `  export function m${index}(value: ${ts}): ${ts};`,
      );
    });
  });

  it('declares the example API', () => {
    const dts = renderNativeDts(
      modelOf({
        types: {
          Analysis: { struct: { rms: 'float32', peak: 'float32' } },
          Preset: { struct: { name: 'string', gains: 'float32[]' } },
        },
        methods: {
          analyze: {
            args: { samples: 'buffer<float32>' },
            returns: 'Analysis',
          },
          getSpectrum: { returns: 'buffer<float32>' },
          loadPreset: {
            args: { path: 'string' },
            returns: 'Preset?',
            async: true,
          },
          applyPreset: { args: { preset: 'Preset' }, returns: 'void' },
          setSolo: { args: { slot: 'int32?' }, returns: 'void' },
        },
      }),
    );
    expect(dts).toBe(`// This file was generated by Soundor. Do not edit.

declare module 'soundor:native' {
  export interface Analysis {
    rms: number;
    peak: number;
  }

  export interface Preset {
    name: string;
    gains: number[];
  }

  export function analyze(samples: Float32Array): Analysis;

  export function applyPreset(preset: Preset): void;

  export function getSpectrum(): Float32Array;

  export function loadPreset(path: string): Promise<Preset | null>;

  export function setSolo(slot: number | null): void;
}
`);
  });
});
