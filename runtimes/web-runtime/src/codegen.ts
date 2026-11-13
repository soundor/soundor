import { describeState, stateJson } from '@soundor/runtime-sdk';
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
  type ResolvedSoundorConfig,
} from '@soundor/runtime-sdk';

import { version as runtimeVersion } from '../package.json';
import type {
  WebEditor,
  WebManifest,
  WebParameterInfo,
} from './client/manifest.ts';
import { renderWebNative } from './native-codegen.ts';
import { renderParameterBehaviors } from './parameter-codegen.ts';

/** The manifest's file name in `.soundor/generated/runtimes/web/`. */
export const MANIFEST_FILE = 'manifest.json';
/** The native API contract's file name, next to the manifest. */
export const NATIVE_FILE = 'native.ts';
/** The parameters' behavior, next to the manifest. */
export const PARAMETERS_FILE = 'parameters.js';

/** The generated files, relative to the runtime's generated directory. */
export function generateWebSources(
  config: ResolvedSoundorConfig,
): CodegenFile[] {
  return [
    {
      path: MANIFEST_FILE,
      contents: `${JSON.stringify(webManifest(config), null, 2)}\n`,
    },
    { path: NATIVE_FILE, contents: renderWebNative(nativeModel(config)) },
    {
      path: PARAMETERS_FILE,
      contents: renderParameterBehaviors(config.parameters),
    },
  ];
}

/** The resolved native API; config validation has already rejected bad input. */
export function nativeModel(config: ResolvedSoundorConfig): NativeApiModel {
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
function webEditor(config: ResolvedSoundorConfig): WebEditor {
  const editor = resolveEditor(config.editor);
  return {
    width: editor.width,
    height: editor.height,
    minWidth: editor.minWidth,
    minHeight: editor.minHeight,
    maxWidth: editor.maxWidth,
    maxHeight: editor.maxHeight,
    resizable: editor.resizable,
    resize: editor.resize,
    fit: editor.fit,
    keepAspectRatio: editor.keepAspectRatio,
  };
}

/**
 * The manifest of a config. Keys are written in a fixed order, so the same
 * config always produces the same bytes.
 */
export function webManifest(config: ResolvedSoundorConfig): WebManifest {
  const native = nativeModel(config);
  return {
    plugin: {
      id: config.plugin.id,
      name: config.plugin.name,
      version: config.plugin.version ?? '0.1.0',
    },
    runtimeVersion,
    editor: webEditor(config),
    state: JSON.parse(stateJson(describeState(config.state, config.native))),
    parameters: config.parameters.map((parameter): WebParameterInfo => {
      const base = {
        id: parameter.id,
        label: parameter.label,
        access: parameter.access,
      };
      switch (parameter.type) {
        case 'boolean':
          return { ...base, type: 'boolean', default: parameter.default };
        case 'choice':
          return {
            ...base,
            type: 'choice',
            options: parameter.options.map((option) => ({
              value: option.value,
              label: option.label,
            })),
            default: parameter.default,
          };
        default:
          return {
            ...base,
            type: parameter.type,
            min: parameter.min,
            max: parameter.max,
            default: parameter.default,
            ...(parameter.step === undefined ? {} : { step: parameter.step }),
            ...(parameter.unit === undefined ? {} : { unit: parameter.unit }),
          };
      }
    }),
    native: {
      types: native.types,
      methods: native.methods.map((method) => ({
        name: method.name,
        async: method.async,
        args: method.args,
        returns: method.returns,
      })),
      events: native.events.map((event) => ({
        name: event.name,
        fields: event.fields,
      })),
      channels: native.channels,
    },
  };
}
