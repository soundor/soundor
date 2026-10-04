/**
 * The Web runtime's `gen` output: only what is specific to the project. The
 * host itself (parameters, transport, `soundor:*` modules) is generic and
 * ships in this package; the project contributes its manifest.
 */

import type { CodegenFile, SoundorConfig } from '@soundor/runtime-sdk';

import type { WebManifest, WebParameterInfo } from './client/manifest';

/** The manifest's file name in `.soundor/generated/runtimes/web/`. */
export const MANIFEST_FILE = 'manifest.json';

/** The generated files, relative to the runtime's generated directory. */
export function generateWebSources(config: SoundorConfig): CodegenFile[] {
  return [
    {
      path: MANIFEST_FILE,
      contents: `${JSON.stringify(webManifest(config), null, 2)}\n`,
    },
  ];
}

/**
 * The manifest of a config. Keys are written in a fixed order, so the same
 * config always produces the same bytes.
 */
export function webManifest(config: SoundorConfig): WebManifest {
  return {
    plugin: { id: config.plugin.id, name: config.plugin.name },
    parameters: config.parameters.map((parameter): WebParameterInfo => {
      switch (parameter.type) {
        case 'float':
        case 'int':
          return {
            id: parameter.id,
            label: parameter.label,
            type: parameter.type,
            min: parameter.min,
            max: parameter.max,
            default: parameter.default,
            ...(parameter.unit === undefined ? {} : { unit: parameter.unit }),
          };
        case 'bool':
          return {
            id: parameter.id,
            label: parameter.label,
            type: 'bool',
            default: parameter.default,
          };
        case 'enum':
          return {
            id: parameter.id,
            label: parameter.label,
            type: 'enum',
            values: [...parameter.values],
            default: parameter.default,
          };
      }
    }),
  };
}
