export type {
  SoundorErrorCode,
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
  CoreBoolParameter,
  CoreEnumParameter,
  CoreFloatParameter,
  CoreIntParameter,
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
  NativeField,
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
  NUMERIC_TYPES,
  PRIMITIVE_TYPES,
  describeNativeApi,
  enumeratorName,
} from './native-api';
export { nativeTsType, renderNativeDts } from './native-dts';
