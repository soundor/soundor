import { describe, expect, it } from 'vitest';

import { defineRuntime, type RuntimeDefinition } from './runtime';

function makeRuntime(id = 'juce'): RuntimeDefinition {
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

describe('defineRuntime', () => {
  it('preserves optional capabilities on factories and descriptors', () => {
    const legacy = defineRuntime(makeRuntime('legacy'));
    expect(legacy.runtime.capabilities).toBeUndefined();
    const capabilities = { devtools: { inspector: true } };
    const supported = defineRuntime({ ...makeRuntime('custom'), capabilities });
    expect(supported.runtime.capabilities).toBe(capabilities);
    expect(supported().runtime.capabilities).toBe(capabilities);
  });
  it('returns a callable factory exposing id and the implementation', () => {
    const runtime = makeRuntime();
    const factory = defineRuntime(runtime);
    expect(typeof factory).toBe('function');
    expect(factory.id).toBe('juce');
    expect(factory.runtime).toEqual(runtime);
    expect(factory().runtime).toBe(factory.runtime);
  });

  it('produces a descriptor carrying id, options, and the runtime', () => {
    const runtime = makeRuntime();
    const factory = defineRuntime(runtime);
    const descriptor = factory({ format: 'vst3' });
    expect(descriptor).toEqual({
      id: 'juce',
      options: { format: 'vst3' },
      runtime,
    });
  });

  it('defaults options to an empty object when omitted', () => {
    const descriptor = defineRuntime(makeRuntime())();
    expect(descriptor.options).toEqual({});
  });

  it('yields an entry assignable to a config runtimes[] slot', () => {
    const factory = defineRuntime(makeRuntime());
    const descriptor = factory({ format: 'vst3' });
    // The descriptor is a live object; only its declarative surface matters to
    // the serializable config view.
    expect({ id: descriptor.id, options: descriptor.options }).toEqual({
      id: 'juce',
      options: { format: 'vst3' },
    });
  });
});
