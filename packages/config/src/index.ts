export type {
  BaseParameter,
  BoolParameter,
  EnumParameter,
  FloatParameter,
  IntParameter,
  MacosSigningConfig,
  NativeApiDeclaration,
  NativeMethodDeclaration,
  NativeTypeDeclaration,
  NativeTypeRef,
  Parameter,
  ParameterType,
  PluginIdentity,
  RuntimeConfig,
  SigningConfig,
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
  LifecycleContext,
  RuntimeMode,
  RuntimePhase,
  LiveUiContext,
  UiBundleContext,
} from './context';

// Code signing
export {
  AD_HOC_IDENTITY,
  MACOS_KEYCHAIN_ENV,
  MACOS_SIGNING_IDENTITY_ENV,
  checkSigningIdentity,
  resolveSigning,
} from './signing';
export type {
  MacosSigning,
  MacosSigningSource,
  SigningContext,
} from './signing';

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
