import { describe, expect, it } from 'vitest';

import {
  describeNativeApi,
  enumeratorName,
  nativeAbiNamespace,
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
    expect(modelOf({})).toEqual({ types: [], methods: [] });
    expect(describeNativeApi(undefined)).toEqual({
      ok: true,
      model: { types: [], methods: [] },
    });
  });

  it('resolves every kind of type reference', () => {
    const model = modelOf({
      types: {
        Curve: { enum: ['linear', 'exponential'] },
        Preset: 'handle',
        Point: { struct: { x: 'number', y: 'number' } },
      },
      methods: {
        everything: {
          args: {
            flag: 'boolean',
            amount: 'number',
            label: 'string',
            bytes: 'ArrayBuffer',
            samples: 'Float32Array',
            curve: 'Curve',
            preset: 'Preset',
            points: 'Point[]',
            names: 'string[]',
          },
          returns: 'Preset[]',
          async: true,
        },
      },
    });
    const [method] = model.methods;
    expect(method!.async).toBe(true);
    expect(method!.args.map((arg) => [arg.name, arg.type])).toEqual([
      ['flag', { kind: 'primitive', name: 'boolean' }],
      ['amount', { kind: 'primitive', name: 'number' }],
      ['label', { kind: 'primitive', name: 'string' }],
      ['bytes', { kind: 'binary', name: 'ArrayBuffer' }],
      ['samples', { kind: 'binary', name: 'Float32Array' }],
      ['curve', { kind: 'declared', name: 'Curve', declaration: 'enum' }],
      ['preset', { kind: 'declared', name: 'Preset', declaration: 'handle' }],
      [
        'points',
        {
          kind: 'array',
          element: { kind: 'declared', name: 'Point', declaration: 'struct' },
        },
      ],
      [
        'names',
        { kind: 'array', element: { kind: 'primitive', name: 'string' } },
      ],
    ]);
    expect(method!.returns).toEqual({
      kind: 'array',
      element: { kind: 'declared', name: 'Preset', declaration: 'handle' },
    });
  });

  it('keeps argument order and defaults returns to void', () => {
    const model = modelOf({
      methods: { mix: { args: { b: 'number', a: 'number' } } },
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
        Leaf: { struct: { value: 'number' } },
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
        types: { lowercase: 'handle', Promise: 'handle' },
        methods: {
          delete: {},
          'not-an-identifier': {},
          __internal: {},
          Upper: {},
          ok: { args: { class: 'number' } },
        },
      }),
    ).toEqual([
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

  it('rejects unsupported struct fields, nested arrays and recursion', () => {
    expect(
      issuesOf({
        types: {
          Preset: 'handle',
          Holder: { struct: { preset: 'Preset', data: 'Float32Array' } },
          Loop: { struct: { next: 'Loop' } },
        },
        methods: { grid: { returns: 'number[][]' } },
      }),
    ).toEqual([
      expect.stringContaining(
        'native.types.Holder.struct.preset: struct fields may be',
      ),
      expect.stringContaining(
        'native.types.Holder.struct.data: struct fields may be',
      ),
      expect.stringContaining(
        "native.types.Loop: struct 'Loop' contains itself (Loop → Loop)",
      ),
      expect.stringContaining(
        "native.methods.grid.returns: 'number[][]' is not supported",
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

describe('enumeratorName', () => {
  it('derives PascalCase C++ enumerators', () => {
    expect(enumeratorName('linear')).toBe('Linear');
    expect(enumeratorName('low-cut')).toBe('LowCut');
    expect(enumeratorName('48k')).toBe('Value48k');
    expect(enumeratorName('---')).toBe('Value');
  });
});

describe('nativeAbiNamespace', () => {
  it('is a deterministic C++ identifier derived from the plugin id', () => {
    const namespace = nativeAbiNamespace('com.acme.reverb');
    expect(namespace).toMatch(/^p_[0-9a-f]{8}$/);
    expect(nativeAbiNamespace('com.acme.reverb')).toBe(namespace);
    // Pinned so an accidental algorithm change (which would silently change
    // every plugin's symbol names) fails loudly.
    expect(namespace).toBe('p_023872d6');
  });

  it('differs between plugins', () => {
    expect(nativeAbiNamespace('com.acme.reverb')).not.toBe(
      nativeAbiNamespace('com.acme.delay'),
    );
  });
});

describe('renderNativeDts', () => {
  it('declares an empty module for an empty API', () => {
    expect(renderNativeDts({ types: [], methods: [] })).toBe(
      "// This file was generated by Soundor. Do not edit.\n\ndeclare module 'soundor:native' {\n}\n",
    );
  });

  it('declares handles, enums, structs, async results and readonly array arguments', () => {
    const dts = renderNativeDts(
      modelOf({
        types: {
          Curve: { enum: ['linear', 'exponential'] },
          Preset: 'handle',
          Point: { struct: { x: 'number', tags: 'string[]' } },
        },
        methods: {
          load: { args: { path: 'string' }, returns: 'Preset', async: true },
          plot: {
            args: { points: 'Point[]', curve: 'Curve' },
            returns: 'number[]',
          },
        },
      }),
    );
    expect(dts).toContain('  export type Curve = "linear" | "exponential";');
    expect(dts).toContain("    readonly __soundorHandle: 'Preset';");
    expect(dts).toContain(
      '  export interface Point {\n    x: number;\n    tags: string[];\n  }',
    );
    expect(dts).toContain(
      '  export function load(path: string): Promise<Preset>;',
    );
    expect(dts).toContain(
      '  export function plot(points: readonly Point[], curve: Curve): number[];',
    );
  });
});
