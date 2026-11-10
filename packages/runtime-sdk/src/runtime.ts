import type {
  Runtime,
  RuntimeDescriptor,
  RuntimeFactory,
  RuntimePackage,
} from '@soundor/config';

/**
 * What {@link defineRuntime} takes: a {@link Runtime} that declares its
 * package and compatibility, which the host checks before any phase runs.
 */
export interface RuntimeDefinition<
  Options extends object = object,
> extends Runtime<Options> {
  readonly package: RuntimePackage;
}

/**
 * Authors a runtime and returns the config-callable factory a runtime package
 * exports (e.g. `juceRuntime`). Calling the factory yields a live {@link
 * RuntimeDescriptor} to drop into a config's `runtimes[]`:
 *
 * ```ts
 * import { name, soundor, version } from '../package.json';
 *
 * export const juceRuntime = defineRuntime<JuceOptions>({
 *   id: 'juce',
 *   // package.json: "soundor": { "compatibility": {
 *   //   "config": ">=0.16.0 <0.17.0", "core": ">=0.16.0 <0.17.0", "schemas": [1] } }
 *   package: { name, version, compatibility: soundor.compatibility },
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
 * The returned descriptor carries the declarative `{ id, options }` plus the
 * implementation; the factory object also exposes `id` and `runtime` directly.
 */
export function defineRuntime<Options extends object = object>(
  definition: RuntimeDefinition<Options>,
): RuntimeFactory<Options> {
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
