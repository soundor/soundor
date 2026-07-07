import type {
  Runtime,
  RuntimeDescriptor,
  RuntimeFactory,
} from '@soundor/config';

/**
 * Authors a runtime and returns the config-callable factory a runtime package
 * exports (e.g. `juceRuntime`). Calling the factory yields a live {@link
 * RuntimeDescriptor} to drop into a config's `runtimes[]`:
 *
 * ```ts
 * export const juceRuntime = defineRuntime<JuceOptions>({
 *   id: 'juce',
 *   async init(config, ctx) { ... },
 *   async gen(config, ctx) { ... },
 *   async dev(config, ctx) { ... },
 *   async build(config, ctx) { ... },
 *   async doctor(config, ctx) { return { checks: [] }; },
 * });
 *
 * // soundor.config.ts
 * runtimes: [juceRuntime({ format: 'vst3' })]
 * ```
 *
 * The returned descriptor carries the declarative `{ id, options }` plus the
 * implementation; the factory object also exposes `id` and `runtime` directly.
 */
export function defineRuntime<
  Options extends Record<string, unknown> = Record<string, unknown>,
>(definition: Runtime<Options>): RuntimeFactory<Options> {
  const factory = (options?: Options): RuntimeDescriptor<Options> => ({
    id: definition.id,
    options: options ?? ({} as Options),
    runtime: definition,
  });
  return Object.assign(factory, {
    id: definition.id,
    runtime: definition,
  });
}
