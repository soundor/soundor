export type {
  SoundorErrorCode,
  SoundorErrorInfo,
  SoundorErrorOptions,
  SoundorIssue,
  RuntimeErrorOptions,
} from './errors';
export {
  EXIT_CODES,
  SoundorError,
  RuntimeError,
  UnknownRuntimeError,
  EnvError,
  exitCodeFor,
  isSoundorError,
} from './errors';

export type { Logger } from './logger';
export { createConsoleLogger } from './logger';

export type {
  CommandProbe,
  CommandRunner,
  ProbeResult,
  RunCommandOptions,
} from './command';
export { CommandFailedError, probeCommand, runCommand } from './command';

export type { FileSystemHost } from './filesystem';
export { createNodeFileSystem } from './filesystem';

export type { ProjectPaths, CreateProjectPathsInput } from './paths';
export { createProjectPaths, rootFromConfigPath } from './paths';

export type {
  CodegenFile,
  CodegenSink,
  CollectingCodegenSink,
} from './codegen';
export { createCodegenSink, nullCodegenSink } from './codegen';

export type {
  CoreBaseParameter,
  CoreBooleanParameter,
  CoreChoiceParameter,
  CoreNumericParameter,
  CoreParameterAccess,
  CoreParameter,
  CorePluginIdentity,
  CoreRuntimeDescriptor,
  CoreSoundorConfig,
  GeneratedFileCheckResult,
  GeneratedFileChange,
  GeneratedFileWriteResult,
} from './generate';
export {
  GeneratedFilesOutOfDateError,
  checkGeneratedFiles,
  generateSoundorFiles,
  writeGeneratedFiles,
} from './generate';

export type {
  IntegerTypeName,
  NativeApiDeclaration,
  NativeApiIssue,
  NativeApiModel,
  NativeApiResult,
  NativeChannelDeclaration,
  NativeChannelModel,
  NativeField,
  NativeEventDeclaration,
  NativeEventModel,
  NativeMethodDeclaration,
  NativeMethodModel,
  NativeType,
  NativeTypeDeclaration,
  NativeTypeModel,
  NativeTypeRef,
  NumericTypeName,
  PrimitiveTypeName,
} from './native-api';
export {
  BUFFER_ARRAY_TYPES,
  FLOAT_TYPES,
  INTEGER_TYPES,
  MAX_CHANNEL_LENGTH,
  NUMERIC_TYPES,
  PRIMITIVE_TYPES,
  describeNativeApi,
  enumeratorName,
} from './native-api';
export {
  nativeTsChannelType,
  nativeTsEventType,
  nativeTsType,
  renderNativeDts,
} from './native-dts';

export * from './state';
export {
  environmentIssues,
  resolveEnvironment,
  renderEnvironmentModule,
} from './env';
export type { EnvironmentValues, EnvironmentMode } from './env';

export { resolveSetter, type ValueOrUpdater } from './setter';
