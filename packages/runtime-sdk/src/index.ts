export { defineRuntime } from './runtime';

// Runtime contract + config surface, re-exported so a runtime author imports
// everything from one place.
export type {
  DoctorCheck,
  DoctorReport,
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
  nullCodegenSink,
  EXIT_CODES,
  EnvError,
  RuntimeError,
  SoundorError,
  UnknownRuntimeError,
  exitCodeFor,
} from '@soundor/core';
export type {
  CodegenFile,
  CodegenSink,
  CollectingCodegenSink,
  FileSystemHost,
  Logger,
  ProjectPaths,
  SoundorErrorCode,
  SoundorIssue,
} from '@soundor/core';
