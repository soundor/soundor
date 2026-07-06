import type { SoundorConfig } from './types';

/**
 * Identity helper for authoring `soundor.config.ts`.
 *
 * Provides editor autocomplete and compile-time validation of the config shape.
 * The `const` type parameter preserves literal types — notably parameter ids —
 * so downstream codegen and hooks can infer keys from the returned value.
 *
 * Performs no runtime work beyond returning the object it is given.
 */
export function defineSoundorConfig<const T extends SoundorConfig>(
  config: T,
): T {
  return config;
}
