export type {
  BaseParameter,
  BoolParameter,
  EditorConfig,
  EditorFit,
  EditorResize,
  FixedEditorConfig,
  LayoutEditorConfig,
  ScaleEditorConfig,
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
  ResolvedEditorConfig,
  RuntimeConfig,
  SigningConfig,
  SoundorConfig,
} from './types';
export { defineSoundorConfig } from './define';
export { DEFAULT_EDITOR_SIZE, resolveEditor } from './editor';
export { parseConfig } from './parse';
export type { ParseConfigOptions } from './parse';

// Runtime contract
export type {
  DoctorCheck,
  DoctorReport,
  DevToolsCapabilities,
  RuntimeCapabilities,
  Runtime,
  RuntimeDescriptor,
  RuntimeFactory,
} from './runtime';

// Versions and compatibility
export {
  CONFIG_VERSION,
  MIN_RUNTIME_API_VERSION,
  RUNTIME_API_VERSION,
} from './version';
export {
  CONFIG_FEATURES,
  HOST_RUNTIME_API,
  checkRuntimeCompatibility,
  runtimeApiVersion,
} from './compatibility';
export type { ConfigFeature, HostRuntimeApi } from './compatibility';
export {
  checkProjectConfigVersion,
  projectConfigVersion,
  sameReleaseLine,
} from './project';
export type {
  LifecycleContext,
  DevSessionContext,
  DevShortcut,
  DevSummaryRow,
  DevToolsConnection,
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
export { ConfigError, isConfigError } from './errors';
export type { ConfigErrorInfo, ConfigIssue, ConfigErrorKind } from './errors';
export {
  EXIT_CODES,
  EnvError,
  RuntimeCompatibilityError,
  RuntimeError,
  SoundorError,
  UnknownRuntimeError,
  exitCodeFor,
  isSoundorError,
} from '@soundor/core';
export type {
  SoundorErrorCode,
  SoundorErrorInfo,
  SoundorErrorOptions,
  SoundorIssue,
} from '@soundor/core';

export { locateConfig } from './load';
export { loadUserSettings, parseUserSettings, userConfigPath } from './user';
export type { DevToolsSettings, UserSettings, UserConfigOptions } from './user';
