/**
 * The Web runtime's `gen` output: only what is specific to the project. The
 * host itself (parameters, transport, `soundor:*` modules) is generic and
 * ships in this package; the project contributes its manifest.
 */

import {
  describeNativeApi,
  resolveEditor,
  SoundorError,
  type CodegenFile,
  type NativeApiModel,
  type SoundorConfig,
} from '@soundor/runtime-sdk';

import type {
  WebEditor,
  WebManifest,
  WebParameterInfo,
} from './client/manifest.ts';
import { renderWebNative } from './native-codegen.ts';

/** The manifest's file name in `.soundor/generated/runtimes/web/`. */
export const MANIFEST_FILE = 'manifest.json';
/** The native API contract's file name, next to the manifest. */
export const NATIVE_FILE = 'native.ts';

/** The generated files, relative to the runtime's generated directory. */
export function generateWebSources(config: SoundorConfig): CodegenFile[] {
  return [
    {
      path: MANIFEST_FILE,
      contents: `${JSON.stringify(webManifest(config), null, 2)}\n`,
    },
    { path: NATIVE_FILE, contents: renderWebNative(nativeModel(config)) },
  ];
}

/** The resolved native API; config validation has already rejected bad input. */
export function nativeModel(config: SoundorConfig): NativeApiModel {
  const result = describeNativeApi(config.native);
  if (!result.ok) {
    throw new SoundorError('Invalid native API declaration.', {
      code: 'CONFIG',
      issues: [...result.issues],
    });
  }
  return result.model;
}

/** The config's editor, resolved as every runtime resolves it. */
function webEditor(config: SoundorConfig): WebEditor {
  const editor = resolveEditor(config.editor);
  return {
    width: editor.width,
    height: editor.height,
    minWidth: editor.minWidth,
    minHeight: editor.minHeight,
    maxWidth: editor.maxWidth,
    maxHeight: editor.maxHeight,
    resizable: editor.resizable,
  };
}

/**
 * The manifest of a config. Keys are written in a fixed order, so the same
 * config always produces the same bytes.
 */
export function webManifest(config: SoundorConfig): WebManifest {
  return {
    plugin: { id: config.plugin.id, name: config.plugin.name },
    editor: webEditor(config),
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
    native: {
      methods: nativeModel(config).methods.map((method) => ({
        name: method.name,
        async: method.async,
      })),
    },
  };
}
