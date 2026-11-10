import type { SoundorConfig } from './types';

/**
 * Identity helper for authoring `soundor.config.ts`.
 *
 * Provides editor autocomplete and compile-time validation of the config shape.
 * Returns it as a {@link SoundorConfig}, so the type of a project's config names
 * only `@soundor/config`, never the packages of its runtimes (which a project
 * with declarations, such as a `composite` one, could not name). Parameter
 * types for the UI are generated (`soundor gen`), not inferred from it.
 *
 * Performs no runtime work beyond returning the object it is given.
 */
export function defineSoundorConfig(config: SoundorConfig): SoundorConfig {
  return config;
}
