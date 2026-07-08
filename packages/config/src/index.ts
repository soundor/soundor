export type {
  BaseParameter,
  BoolParameter,
  EnumParameter,
  FloatParameter,
  IntParameter,
  NativeMethod,
  Parameter,
  ParameterType,
  RuntimeConfig,
  SoundorConfig,
} from './types';
export { defineSoundorConfig } from './define';
export { parseConfig } from './parse';
export type { ParseConfigOptions } from './parse';

// Runtime contract
export type {
  DoctorCheck,
  DoctorReport,
  Runtime,
  RuntimeDescriptor,
  RuntimeFactory,
} from './runtime';
export type {
  BuildContext,
  BuildUiContext,
  DevContext,
  DevUiContext,
  LifecycleContext,
  RuntimeMode,
  RuntimePhase,
} from './context';

// Resolution + dispatch
export { resolveRuntime, runPhase } from './registry';
export type { DispatchContextInput, ResolvedRuntime } from './registry';

// Errors: config's own plus the shared taxonomy from core
export { ConfigError } from './errors';
export type { ConfigIssue, ConfigErrorKind } from './errors';
export {
  EXIT_CODES,
  EnvError,
  RuntimeError,
  SoundorError,
  UnknownRuntimeError,
  exitCodeFor,
} from '@soundor/core';
export type {
  SoundorErrorCode,
  SoundorErrorOptions,
  SoundorIssue,
} from '@soundor/core';
