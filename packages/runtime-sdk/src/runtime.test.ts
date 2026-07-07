import type { Runtime } from '@soundor/config';
import { describe, expect, it } from 'vitest';

import { defineRuntime } from './runtime';

function makeRuntime(id = 'juce'): Runtime {
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
  it('returns a callable factory exposing id and the implementation', () => {
    const runtime = makeRuntime();
    const factory = defineRuntime(runtime);
    expect(typeof factory).toBe('function');
    expect(factory.id).toBe('juce');
    expect(factory.runtime).toBe(runtime);
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
