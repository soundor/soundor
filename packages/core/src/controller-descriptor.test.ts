import { describe, expect, it } from 'vitest';

import { byteLiterals, describeController } from './controller-descriptor';
import { describeNativeApi } from './native-api';
import { describeState } from './state';

function model(native: Parameters<typeof describeNativeApi>[0]) {
  const result = describeNativeApi(native);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.model;
}

describe('describeController', () => {
  it('lays out the contract as the engine and the Rust SDK read it', () => {
    const native = model({
      types: { Curve: { enum: ['linear', 'low-cut'] } },
      events: { picked: { current: 'Curve' } },
      methods: {
        pick: {
          args: { curve: 'Curve?' },
          returns: 'buffer<float32>',
          async: true,
        },
      },
    });
    const bytes = describeController(native, { fields: [], types: [] }, 3);
    const u32 = (value: number) => [value, 0, 0, 0];
    const text = (value: string) => [
      ...u32(value.length),
      ...[...value].map((c) => c.charCodeAt(0)),
    ];
    expect([...bytes]).toEqual([
      ...[...'SNDC'].map((c) => c.charCodeAt(0)),
      ...u32(2), // version
      ...u32(3), // parameters
      ...u32(1), // types
      1, // an enum
      ...text('Curve'),
      ...u32(2),
      ...text('linear'),
      ...text('low-cut'),
      ...u32(0), // state fields
      ...u32(1), // methods
      ...text('pick'),
      1, // async
      ...u32(1),
      ...text('curve'),
      16, // nullable
      13, // declared
      ...u32(0),
      15, // buffer
      11, // of float32
      ...u32(1), // events
      ...text('picked'),
      ...u32(1), // fields
      ...text('current'),
      13, // declared
      ...u32(0),
    ]);
  });

  it('describes the state fields, in their order, and is deterministic', () => {
    const native = model({
      types: { Point: { struct: { x: 'float64', y: 'float64' } } },
    });
    const state = describeState(
      {
        selected: { type: 'string?', default: null },
        points: { type: 'Point[]', default: [] },
      },
      { types: { Point: { struct: { x: 'float64', y: 'float64' } } } },
    );
    const first = describeController(native, state, 0);
    expect(describeController(native, state, 0)).toEqual(first);
    // In the schema's order, which the runtime's state store and the SDK's
    // StateAccess number them by.
    const text = new TextDecoder('latin1').decode(first);
    const [a, b] = state.fields.map((field) => field.name);
    expect(text.indexOf(a!)).toBeLessThan(text.indexOf(b!));
  });

  it('writes bytes as literals', () => {
    expect(byteLiterals(Uint8Array.of(1, 2, 3), '  ', 2)).toBe('  1, 2,\n  3,');
  });
});
