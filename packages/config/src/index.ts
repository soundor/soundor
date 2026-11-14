export type {
  AudioBus,
  AudioChannelLayout,
  AudioConfig,
  AudioLatency,
  AudioTail,
} from './audio';
export { initialBusLayout } from './audio';
export type {
  EditorConfig,
  EditorFit,
  EditorResize,
  FixedEditorConfig,
  LayoutEditorConfig,
  ScaleEditorConfig,
  MacosSigningConfig,
  NativeApiDeclaration,
  NativeChannelDeclaration,
  NativeEventDeclaration,
  NativeMethodDeclaration,
  NativeTypeDeclaration,
  NativeTypeRef,
  PluginIdentity,
  PluginKind,
  PluginCategory,
  PluginVendor,
  ParameterGroup,
  ResolvedEditorConfig,
  RuntimeConfig,
  SigningConfig,
  ResolvedSoundorConfig,
  SoundorConfig,
} from './types';
export {
  INTEGER_PARAMETER_TYPES,
  MAX_INTEGER_PARAMETER_MAGNITUDE,
  MAX_INTEGER_PARAMETER_STEPS,
  PARAMETER_ACCESS,
  PARAMETER_TYPES,
  semanticsInputs,
} from './parameters';
export type {
  BooleanParameter,
  CheckParameter,
  CheckedParameters,
  ChoiceOption,
  ChoiceParameter,
  CustomMapping,
  Float32Parameter,
  FormatContext,
  Formatter,
  IntegerParameter,
  IntegerParameterType,
  Mapping,
  NumericParameter,
  NumericParameterType,
  Parameter,
  ParameterAccess,
  ParameterBase,
  ParameterDeclarations,
  ParameterSemantics,
  ParameterType,
  ParameterValueType,
  ParseContext,
  Parser,
  PowerMapping,
  ResolvedBooleanParameter,
  ResolvedChoiceParameter,
  ResolvedMapping,
  ResolvedNumericParameter,
  ResolvedParameter,
  SymmetricPowerMapping,
  TextConversion,
  ToNormalizedContext,
  ToValueContext,
} from './parameters';
export { defineSoundorConfig } from './define';
export { DEFAULT_EDITOR_SIZE, resolveEditor } from './editor';
export { parseConfig } from './parse';
export { validateConfig as resolveConfig } from './schema';
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
export { CONFIG_VERSION } from './version';
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

export type {
  StateDeclaration,
  StateDeclarations,
  StateValue,
} from '@soundor/core';
