/**
 * Soundor configuration model.
 *
 * Config is declarative: it describes *what* a project exposes — parameters,
 * runtimes, native methods. A runtime entry additionally carries its live
 * {@link RuntimeDescriptor} implementation (the object returned by a runtime
 * factory), which the CLI dispatches; core itself stays declarative.
 */

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
 * Declaration of a method implemented natively by a runtime.
 *
 * Only the shape is declared here — `input` and `output` name the types the
 * method consumes and produces; core carries them without interpretation.
 */
export interface NativeMethod {
  name: string;
  input: string;
  output: string;
}

/** Top-level Soundor configuration. */
export interface SoundorConfig {
  runtimes: RuntimeDescriptor[];
  parameters: Parameter[];
  nativeMethods?: NativeMethod[];
}
