import { describe, expect, expectTypeOf, it } from 'vitest';

import { defineSoundorConfig } from '../index';
import type { Runtime } from '../runtime';

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
    parameters: [
      {
        type: 'float',
        id: 'gain',
        label: 'Gain',
        min: 0,
        max: 1,
        default: 0.5,
      },
      { type: 'bool', id: 'bypass', label: 'Bypass', default: false },
    ],
    native: { methods: { render: { args: { input: 'string' } } } },
  });

  it('returns the config unchanged', () => {
    expect(config.runtimes[0].id).toBe('juce');
    expect(config.parameters).toHaveLength(2);
  });

  it('preserves parameter ids as string literals', () => {
    // `const` inference pins the literal ids so downstream codegen can read them.
    expectTypeOf(config.parameters[0].id).toEqualTypeOf<'gain'>();
    expectTypeOf(config.runtimes[0].id).toEqualTypeOf<'juce'>();
  });

  it('requires a runtime implementation on each entry (type-level)', () => {
    // A bare `{ id, options }` entry is now a compile error: the field is typed
    // with the live runtime. The @ts-expect-error is itself checked — if the
    // entry were accepted, the unused directive would fail the build.
    const authored = defineSoundorConfig({
      plugin: { id: 'com.example.test', name: 'Test' },
      // @ts-expect-error missing `runtime`; use a factory, e.g. juceRuntime({ ... })
      runtimes: [{ id: 'juce', options: {} }],
      parameters: [],
    });
    expect(authored.runtimes).toHaveLength(1);
  });

  it('rejects an invalid parameter shape at author time', () => {
    const authored = defineSoundorConfig({
      plugin: { id: 'com.example.test', name: 'Test' },
      runtimes: [],
      parameters: [
        {
          type: 'float',
          id: 'gain',
          label: 'Gain',
          min: 0,
          max: 10,
          default: 2,
        },
      ],
    });
    expect(authored.parameters).toHaveLength(1);
  });

  it('allows fit for a resizable editor, keepAspectRatio for one that scales (type-level)', () => {
    const base = {
      plugin: { id: 'com.example.test', name: 'Test' },
      runtimes: [],
      parameters: [],
    };
    const cover = defineSoundorConfig({
      ...base,
      editor: { resizable: true, resize: 'scale', fit: 'cover' },
    });
    expect(cover.editor.fit).toBe('cover');
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
