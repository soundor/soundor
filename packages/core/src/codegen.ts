/**
 * Codegen sink — the write-side seam a runtime's `gen` phase emits generated
 * source to, without knowing how it is materialized.
 *
 * CONTRACT ONLY for now: real emission, formatting, and manifest handling land
 * in a later codegen task. This module ships the interface plus two trivial
 * implementations — an in-memory collector (for tests and dry runs) and a
 * no-op — so the runtime contract is complete today.
 */

/** A single generated source artifact. */
export interface CodegenFile {
  /** Path relative to {@link ProjectPaths.gen}. */
  path: string;
  contents: string;
}

/** Destination a runtime emits generated files to. */
export interface CodegenSink {
  emit(file: CodegenFile): void;
  emitAll(files: Iterable<CodegenFile>): void;
}

/** A {@link CodegenSink} that also exposes what it collected. */
export interface CollectingCodegenSink extends CodegenSink {
  /** The files emitted so far, in emission order. */
  files(): CodegenFile[];
}

/**
 * A {@link CodegenSink} that records emitted files in memory. Later emits to the
 * same `path` overwrite earlier ones, matching real generation semantics.
 */
export function createCodegenSink(): CollectingCodegenSink {
  const byPath = new Map<string, CodegenFile>();
  const sink: CollectingCodegenSink = {
    emit(file: CodegenFile): void {
      byPath.set(file.path, file);
    },
    emitAll(files: Iterable<CodegenFile>): void {
      for (const file of files) sink.emit(file);
    },
    files(): CodegenFile[] {
      return [...byPath.values()];
    },
  };
  return sink;
}

/** A {@link CodegenSink} that discards everything emitted to it. */
export const nullCodegenSink: CodegenSink = {
  emit(): void {},
  emitAll(): void {},
};
