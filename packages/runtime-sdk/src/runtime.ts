import {
  type Runtime,
  type RuntimeDescriptor,
  type RuntimeFactory,
} from '@soundor/config';

/** The lifecycle implementation accepted by {@link defineRuntime}. */
export type RuntimeDefinition<Options extends object = object> =
  Runtime<Options>;

/**
 * Authors a runtime and returns the config-callable factory a runtime package
 * exports (e.g. `vst3Runtime`). Calling the factory yields a live {@link
 * RuntimeDescriptor} to drop into a config's `runtimes[]`:
 *
 * ```ts
 * import type { RuntimeFactory } from '@soundor/config';
 *
 * export const vst3Runtime: RuntimeFactory<Vst3Options> = defineRuntime({
 *   id: 'vst3',
 *   async gen(config, ctx) { ... },
 *   async dev(config, ctx) { ... },
 *   async build(config, ctx) { ... },
 *   async doctor(config, ctx) { return { checks: [] }; },
 * });
 *
 * // soundor.config.ts
 * runtimes: [vst3Runtime({ timeLimit: 5000 })]
 * ```
 *
 * The returned descriptor carries the declarative `{ id, options }` plus the implementation;
 * the factory object also exposes `id` and `runtime` directly.
 */
export function defineRuntime<Options extends object = object>(
  definition: RuntimeDefinition<Options>,
): RuntimeFactory<Options> {
  const runtime: Runtime<Options> = {
    ...definition,
  };
  const factory = (options?: Options): RuntimeDescriptor<Options> => ({
    id: runtime.id,
    options: options ?? ({} as Options),
    runtime,
  });
  return Object.assign(factory, { id: runtime.id, runtime });
}
