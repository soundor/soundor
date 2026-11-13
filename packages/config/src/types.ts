/**
 * Soundor configuration model.
 *
 * Config is declarative: it describes *what* a project exposes — parameters,
 * runtimes, native methods. A runtime entry additionally carries its live
 * {@link RuntimeDescriptor} implementation (the object returned by a runtime
 * factory), which the CLI dispatches; core itself stays declarative.
 */

import type { EnvironmentValues } from '@soundor/core';
import type { StateDeclarations } from '@soundor/core';
import type { NativeApiDeclaration } from '@soundor/core';

import type { EditorConfig, ResolvedEditorConfig } from './editor';
import type {
  CheckedParameters,
  ParameterDeclarations,
  ResolvedParameter,
} from './parameters';
import type { RuntimeDescriptor } from './runtime';

/**
 * The declarative `{ id, options }` view of a runtime target. `options` is an
 * opaque, runtime-owned surface: core never interprets it, it only carries the
 * values through to the runtime identified by `id`.
 *
 * A config's `runtimes[]` holds the richer {@link RuntimeDescriptor}, which
 * extends this with the live {@link Runtime} implementation.
 */
export interface RuntimeConfig {
  /** Identifier of the runtime that owns `options` (e.g. `'juce'`). */
  id: string;
  /** Runtime-specific options. Core treats this as an opaque bag. */
  options?: object;
}

/**
 * Who the plugin is, independent of any runtime or plugin format.
 *
 * `id` is the stable, globally unique identifier (reverse-DNS, e.g.
 * `com.acme.reverb`). Runtimes derive format identities from it, and Soundor
 * derives the namespace that keeps this plugin's native symbols apart from every
 * other Soundor plugin in the same host process — so never change it after
 * release.
 */
export interface PluginIdentity {
  /** Release version, shared by all formats. Defaults to 0.1.0. */
  version?: string;
  id: string;
  /** Display name hosts show. */
  name: string;
}

export type {
  EditorConfig,
  EditorFit,
  EditorResize,
  FixedEditorConfig,
  LayoutEditorConfig,
  ScaleEditorConfig,
  ResolvedEditorConfig,
} from './editor';

export type {
  NativeApiDeclaration,
  NativeChannelDeclaration,
  NativeEventDeclaration,
  NativeMethodDeclaration,
  NativeTypeDeclaration,
  NativeTypeRef,
} from '@soundor/core';

/** macOS code signing. */
export interface MacosSigningConfig {
  /**
   * The identity runtimes sign macOS binaries with: the name of a certificate
   * in the keychain (e.g. `Developer ID Application: Acme (ABCDE12345)`) or
   * its SHA-1 hash. Not a secret. `SOUNDOR_MACOS_SIGNING_IDENTITY` overrides
   * it; without either, binaries are signed ad-hoc.
   */
  identity?: string;
}

/**
 * Code signing, shared by every runtime that produces signed binaries.
 * Key material never goes here: `codesign` finds the key in the keychain.
 */
export interface SigningConfig {
  macos?: MacosSigningConfig;
}

/**
 * A project's configuration, as `soundor.config.ts` declares it.
 *
 * `P` is the parameters' declarations, which {@link defineSoundorConfig}
 * infers so that each is checked against its own type: a choice's default
 * against its options, a parser's result against the parameter's type.
 */
export interface SoundorConfig<
  P extends ParameterDeclarations = ParameterDeclarations,
> {
  plugin: PluginIdentity;
  /** Public build-time values for soundor:env. Never include secrets; omitted values are not inherited from process.env. */
  env?: EnvironmentValues;
  /**
   * The plugin editor's size, and whether it can be resized; the same in
   * every runtime. Omitted, the editor is a fixed 800×600 view.
   */
  editor?: EditorConfig;
  runtimes: RuntimeDescriptor[];
  /**
   * The parameters hosts automate and store, by key. A key is the
   * parameter's identity in saved sessions: never rename one after release.
   * Their order is the order hosts list them in.
   */
  parameters?: CheckedParameters<P>;
  /** The plugin's typed native API, exposed to JavaScript as `soundor:native`. */
  native?: NativeApiDeclaration;
  /** Application data persisted with the plugin; never host parameters. */
  state?: StateDeclarations;
  /** Code signing; runtimes read the resolved settings from `ctx.signing`. */
  signing?: SigningConfig;
}

/**
 * A validated config, every field decided: what `parseConfig` returns and
 * what runtimes receive.
 */
export interface ResolvedSoundorConfig {
  plugin: PluginIdentity;
  /** Public build-time values for soundor:env. Never include secrets; omitted values are not inherited from process.env. */
  env?: EnvironmentValues;
  /**
   * Resolved by validation; runtimes resolve it with `resolveEditor` either
   * way, so a config built by hand may give any editor config.
   */
  editor?: EditorConfig | ResolvedEditorConfig;
  runtimes: RuntimeDescriptor[];
  /** In declaration order, which is the order hosts list them in. */
  parameters: readonly ResolvedParameter[];
  native?: NativeApiDeclaration;
  /** Application data persisted with the plugin; never host parameters. */
  state?: StateDeclarations;
  signing?: SigningConfig;
}
