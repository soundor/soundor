export { defineRuntime } from './runtime';

// Runtime contract + config surface, re-exported so a runtime author imports
// everything from one place.
export type {
  BuildContext,
  BuildUiContext,
  DoctorCheck,
  DoctorReport,
  DevContext,
  DevUiContext,
  LifecycleContext,
  Runtime,
  RuntimeConfig,
  RuntimeDescriptor,
  RuntimeFactory,
  RuntimeMode,
  RuntimePhase,
  SoundorConfig,
  ResolvedRuntime,
  DispatchContextInput,
} from '@soundor/config';
export { ConfigError, resolveRuntime, runPhase } from '@soundor/config';

// Host helpers + shared error taxonomy from @soundor/core.
export {
  createCodegenSink,
  createConsoleLogger,
  createNodeFileSystem,
  createProjectPaths,
  checkGeneratedFiles,
  generateSoundorFiles,
  nullCodegenSink,
  writeGeneratedFiles,
  probeCommand,
  runCommand,
  CommandFailedError,
  EXIT_CODES,
  EnvError,
  GeneratedFilesOutOfDateError,
  RuntimeError,
  SoundorError,
  UnknownRuntimeError,
  exitCodeFor,
} from '@soundor/core';
export type {
  CodegenFile,
  CodegenSink,
  CollectingCodegenSink,
  CommandProbe,
  CommandRunner,
  ProbeResult,
  RunCommandOptions,
  CoreBaseParameter,
  CoreBoolParameter,
  CoreEnumParameter,
  CoreFloatParameter,
  CoreIntParameter,
  CoreNativeMethod,
  CoreParameter,
  CoreRuntimeDescriptor,
  CoreSoundorConfig,
  FileSystemHost,
  GeneratedFileChange,
  Logger,
  ProjectPaths,
  SoundorErrorCode,
  SoundorIssue,
} from '@soundor/core';
