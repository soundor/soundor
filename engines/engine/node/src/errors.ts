/** Why engine() failed. */
export type EngineErrorCode =
  /** The options name no target, mode or variant engine() knows. */
  | 'invalid-options'
  /** No published artifact can be used, and none may be built here. */
  | 'unavailable'
  /** The release metadata could not be read, or describes something else. */
  | 'manifest'
  /** A download failed, or what came is not what the manifest names. */
  | 'download'
  /** An artifact (downloaded, cached, built or given) is not a valid one. */
  | 'artifact'
  /** Building from source failed, or its tools are missing. */
  | 'build';

/**
 * engine()'s errors: name `SoundorEngineError` and a `code`. Recognize them
 * by those, not by `instanceof`: a project can hold several copies of the
 * package.
 */
export class EngineError extends Error {
  override readonly name = 'SoundorEngineError';
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}
