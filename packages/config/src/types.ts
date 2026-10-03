/**
 * Soundor configuration model.
 *
 * Config is declarative: it describes *what* a project exposes — parameters,
 * runtimes, native methods. A runtime entry additionally carries its live
 * {@link RuntimeDescriptor} implementation (the object returned by a runtime
 * factory), which the CLI dispatches; core itself stays declarative.
 */

import type { NativeApiDeclaration } from '@soundor/core';

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

/** Fields shared by every parameter variant. */
export interface BaseParameter {
  /** Stable identifier used as the key by downstream codegen and hooks. */
  id: string;
  label: string;
  /** Name of a hook invoked when the value changes. Types only, no logic. */
  onChange?: string;
}

/** Continuous, floating-point parameter. */
export interface FloatParameter extends BaseParameter {
  type: 'float';
  min: number;
  max: number;
  default: number;
  unit?: string;
}

/** Discrete, integer parameter. */
export interface IntParameter extends BaseParameter {
  type: 'int';
  min: number;
  max: number;
  default: number;
  unit?: string;
}

/** Boolean toggle parameter. */
export interface BoolParameter extends BaseParameter {
  type: 'bool';
  default: boolean;
}

/** Enumerated choice parameter. */
export interface EnumParameter extends BaseParameter {
  type: 'enum';
  values: string[];
  default: string;
}

/** Any declared parameter. */
export type Parameter =
  | FloatParameter
  | IntParameter
  | BoolParameter
  | EnumParameter;

/** The declared `type` discriminant of a {@link Parameter}. */
export type ParameterType = Parameter['type'];

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
  id: string;
  /** Display name hosts show. */
  name: string;
}

export type {
  NativeApiDeclaration,
  NativeMethodDeclaration,
  NativeTypeDeclaration,
  NativeTypeRef,
} from '@soundor/core';

/** Top-level Soundor configuration. */
export interface SoundorConfig {
  plugin: PluginIdentity;
  runtimes: RuntimeDescriptor[];
  parameters: Parameter[];
  /** The plugin's typed native API, exposed to JavaScript as `soundor:native`. */
  native?: NativeApiDeclaration;
}
