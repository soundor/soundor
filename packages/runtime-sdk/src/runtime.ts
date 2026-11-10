import {
  RUNTIME_API_VERSION,
  type Runtime,
  type RuntimeDescriptor,
  type RuntimeFactory,
} from '@soundor/config';

/**
 * What {@link defineRuntime} takes: a {@link Runtime}, whose `apiVersion` it
 * sets itself.
 */
export type RuntimeDefinition<Options extends object = object> = Omit<
  Runtime<Options>,
  'apiVersion'
>;

/**
 * Authors a runtime and returns the config-callable factory a runtime package
 * exports (e.g. `juceRuntime`). Calling the factory yields a live {@link
 * RuntimeDescriptor} to drop into a config's `runtimes[]`:
 *
 * ```ts
 * import type { RuntimeFactory } from '@soundor/config';
 *
 * export const juceRuntime: RuntimeFactory<JuceOptions> = defineRuntime({
 *   id: 'juce',
 *   async init(config, ctx) { ... },
 *   async gen(config, ctx) { ... },
 *   async dev(config, ctx) { ... },
 *   async build(config, ctx) { ... },
 *   async doctor(config, ctx) { return { checks: [] }; },
 * });
 *
 * // soundor.config.ts
 * runtimes: [juceRuntime({ plugin: { formats: ['vst3'] } })]
 * ```
 *
 * The runtime is given the `RUNTIME_API_VERSION` of the `@soundor/config` the
 * runtime is built with, which the host checks before running it. The returned
 * descriptor carries the declarative `{ id, options }` plus the implementation;
 * the factory object also exposes `id` and `runtime` directly.
 */
export function defineRuntime<Options extends object = object>(
  definition: RuntimeDefinition<Options>,
): RuntimeFactory<Options> {
  const runtime: Runtime<Options> = {
    ...definition,
    apiVersion: RUNTIME_API_VERSION,
  };
  const factory = (options?: Options): RuntimeDescriptor<Options> => ({
    id: runtime.id,
    options: options ?? ({} as Options),
    runtime,
  });
  return Object.assign(factory, { id: runtime.id, runtime });
}
