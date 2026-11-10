import type { Expression } from '@soundor/expression';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { defineSoundorConfig } from '../index';
import type { Runtime } from '../runtime';
import type { SoundorConfig } from '../types';

const noop = async (): Promise<void> => {};
function makeRuntime(id: string): Runtime {
  return {
    id,
    init: noop,
    gen: noop,
    dev: noop,
    build: noop,
    doctor: async () => ({ checks: [] }),
  };
}

describe('defineSoundorConfig', () => {
  const config = defineSoundorConfig({
    plugin: { id: 'com.example.test', name: 'Test' },
    runtimes: [
      { id: 'juce', options: { format: 'vst3' }, runtime: makeRuntime('juce') },
    ],
    parameters: {
      gain: { type: 'float32', label: 'Gain', min: 0, max: 1, default: 0.5 },
      bypass: { type: 'boolean', label: 'Bypass', default: false },
    },
    native: { methods: { render: { args: { input: 'string' } } } },
  });

  it('returns the config unchanged', () => {
    expect(config.runtimes[0]?.id).toBe('juce');
    expect(Object.keys(config.parameters ?? {})).toEqual(['gain', 'bypass']);
  });

  it('returns a SoundorConfig, naming no runtime package', () => {
    expectTypeOf(config).toEqualTypeOf<SoundorConfig>();
  });

  it('requires a runtime implementation on each entry (type-level)', () => {
    // A bare `{ id, options }` entry is now a compile error: the field is typed
    // with the live runtime. The @ts-expect-error is itself checked — if the
    // entry were accepted, the unused directive would fail the build.
    const authored = defineSoundorConfig({
      plugin: { id: 'com.example.test', name: 'Test' },
      // @ts-expect-error missing `runtime`; use a factory, e.g. juceRuntime({ ... })
      runtimes: [{ id: 'juce', options: {} }],
    });
    expect(authored.runtimes).toHaveLength(1);
  });

  it('types expressions by the parameter type, without annotations', () => {
    const authored = defineSoundorConfig({
      plugin: { id: 'com.example.test', name: 'Test' },
      runtimes: [],
      parameters: {
        frequency: {
          type: 'float32',
          min: 20,
          max: 20000,
          default: 1000,
          mapping: 'log',
          format: (e) => {
            expectTypeOf(e.value).toEqualTypeOf<Expression<'float32'>>();
            return e.if(
              e.gte(e.value, 1000),
              e.concat(e.fixed(e.div(e.value, 1000), 2), ' kHz'),
              e.concat(e.fixed(e.value, 0), ' Hz'),
            );
          },
          parse: (e) => e.parseFloat32(e.text),
        },
        voices: {
          type: 'int32',
          min: 1,
          max: 32,
          default: 8,
          parse: (e) => {
            expectTypeOf(e.text).toEqualTypeOf<Expression<'string'>>();
            return e.parseInt32(e.text);
          },
        },
        curve: {
          type: 'float32',
          min: 0,
          max: 1,
          default: 0.5,
          mapping: {
            type: 'custom',
            toValue: (e) => e.mul(e.normalized, e.normalized),
            toNormalized: (e) => e.sqrt(e.value),
          },
        },
        filterType: {
          type: 'choice',
          options: [
            { value: 'bell', label: 'Bell' },
            { value: 'lowpass', label: 'Low Pass' },
          ],
          default: 'lowpass',
        },
      },
    });
    expect(Object.keys(authored.parameters ?? {})).toHaveLength(4);
  });

  it('rejects what does not fit the parameter type (type-level)', () => {
    const base = {
      plugin: { id: 'com.example.test', name: 'Test' },
      runtimes: [],
    };
    const options = [
      { value: 'bell', label: 'Bell' },
      { value: 'lowpass', label: 'Low Pass' },
    ] as const;
    defineSoundorConfig({
      ...base,
      parameters: {
        filterType: {
          type: 'choice',
          options: [
            { value: 'bell', label: 'Bell' },
            { value: 'lowpass', label: 'Low Pass' },
          ],
          // @ts-expect-error 'notch' is not one of the options
          default: 'notch',
        },
      },
    });
    defineSoundorConfig({
      ...base,
      parameters: { filterType: { type: 'choice', options, default: 'bell' } },
    });
    defineSoundorConfig({
      ...base,
      parameters: {
        voices: {
          type: 'int32',
          min: 1,
          max: 32,
          default: 8,
          // @ts-expect-error an int32 parser returns an int32?
          parse: (e) => e.parseFloat32(e.text),
        },
      },
    });
    defineSoundorConfig({
      ...base,
      parameters: {
        // @ts-expect-error a custom format needs a parse
        gain: {
          type: 'float32',
          min: 0,
          max: 1,
          default: 0,
          format: (e) => e.fixed(e.value, 1),
        },
      },
    });
    defineSoundorConfig({
      ...base,
      parameters: {
        gain: {
          type: 'float32',
          min: 0,
          max: 1,
          default: 0,
          // @ts-expect-error a format writes a string
          format: (e) => e.value,
          parse: 'default',
        },
      },
    });
    defineSoundorConfig({
      ...base,
      parameters: {
        // @ts-expect-error integers are linear
        voices: { type: 'int16', min: 1, max: 32, default: 8, mapping: 'log' },
      },
    });
    defineSoundorConfig({
      ...base,
      parameters: {
        // @ts-expect-error float64 is not a parameter type
        gain: { type: 'float64', min: 0, max: 1, default: 0 },
      },
    });
    defineSoundorConfig({
      ...base,
      parameters: {
        mode: {
          type: 'choice',
          options: [
            { value: 'a', label: 'A' },
            // @ts-expect-error a repeated value
            { value: 'a', label: 'Other' },
          ],
          default: 'a',
        },
      },
    });
    defineSoundorConfig({
      ...base,
      parameters: {
        // @ts-expect-error booleans have no range
        on: { type: 'boolean', default: true, min: 0 },
      },
    });
    defineSoundorConfig({
      ...base,
      parameters: {
        // @ts-expect-error an unknown access
        on: { type: 'boolean', default: true, access: 'hidden' },
      },
    });
  });

  it('allows fit for a resizable editor, keepAspectRatio for one that scales (type-level)', () => {
    const base = {
      plugin: { id: 'com.example.test', name: 'Test' },
      runtimes: [],
    };
    const cover = defineSoundorConfig({
      ...base,
      editor: { resizable: true, resize: 'scale', fit: 'cover' },
    });
    expect(cover.editor?.fit).toBe('cover');
    defineSoundorConfig({
      ...base,
      editor: { resizable: true, fit: 'cover', maxWidth: 1000 },
    });
    defineSoundorConfig({
      ...base,
      editor: { resizable: true, maxWidth: Infinity, maxHeight: Infinity },
    });
    defineSoundorConfig({
      ...base,
      // @ts-expect-error a fixed editor has no fit
      editor: { fit: 'cover' },
    });
    // Any editor that scales may let go of its aspect ratio; no other.
    for (const fit of ['contain', 'cover'] as const)
      defineSoundorConfig({
        ...base,
        editor: {
          resizable: true,
          resize: 'scale',
          fit,
          keepAspectRatio: false,
        },
      });
    defineSoundorConfig({
      ...base,
      // @ts-expect-error keepAspectRatio needs resize: 'scale'
      editor: { resizable: true, keepAspectRatio: false },
    });
  });
});
