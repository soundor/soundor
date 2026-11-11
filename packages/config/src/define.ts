import type {
  StateDeclarations,
  NativeApiDeclaration,
  CheckedState,
} from '@soundor/core';

import type { ParameterDeclarations } from './parameters';
import type { SoundorConfig } from './types';

/**
 * Identity helper for authoring `soundor.config.ts`.
 *
 * Provides editor autocomplete and compile-time validation of the config
 * shape. Each parameter is checked against its own declaration: a choice's
 * `default` must be one of its options' values, and a `format` or `parse`
 * expression is typed by the parameter's `type`, without annotations or
 * `as const`. Returns it as a {@link SoundorConfig}, so the type of a
 * project's config names only `@soundor/config`, never the packages of its
 * runtimes (which a project with declarations, such as a `composite` one,
 * could not name). Parameter types for the UI are generated (`soundor gen`).
 *
 * Performs no runtime work beyond returning the object it is given.
 */
export function defineSoundorConfig<
  const P extends ParameterDeclarations = Record<never, never>,
  const S extends StateDeclarations = Record<never, never>,
  const N extends NativeApiDeclaration = NativeApiDeclaration,
>(
  config: Omit<SoundorConfig<P>, 'state' | 'native'> & {
    native?: N;
    state?: S & CheckedState<S, N>;
  },
): SoundorConfig {
  return config as unknown as SoundorConfig;
}
