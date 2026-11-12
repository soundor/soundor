/**
 * Shared error taxonomy for every Soundor package.
 *
 * A single base ({@link SoundorError}) carries a machine-stable {@link
 * SoundorErrorCode}; each code maps to a fixed process exit code via {@link
 * EXIT_CODES}. Downstream packages subclass the base (e.g. `ConfigError` in
 * `@soundor/config`) so a CLI can classify any thrown value with {@link
 * exitCodeFor} and exit deterministically.
 *
 * Errors cross package boundaries: a runtime throws one from its own copy of
 * this package, and the CLI, with another copy, classifies it. So they are
 * recognized by a protocol ({@link isSoundorError}: a global brand, a string
 * `code` and an `issues` list), never by `instanceof`, which only holds within
 * one copy.
 */

/** Machine-stable error codes. Each maps to a fixed CLI exit code. */
export type SoundorErrorCode =
  | 'CONFIG'
  | 'ENV'
  | 'UNKNOWN_RUNTIME'
  | 'RUNTIME'
  | 'INTERNAL'
  | 'TRANSACTION_ABORTED';

/** Stable, documented process exit codes — one per {@link SoundorErrorCode}. */
export const EXIT_CODES: Readonly<Record<SoundorErrorCode, number>> = {
  CONFIG: 2,
  ENV: 3,
  UNKNOWN_RUNTIME: 4,
  RUNTIME: 5,
  TRANSACTION_ABORTED: 5,
  INTERNAL: 70, // sysexits EX_SOFTWARE
};

/** A single, actionable problem. Mirrors the shape config surfaces per issue. */
export interface SoundorIssue {
  /** Location of the problem, e.g. `runtimes[0].id`. Empty for whole-file issues. */
  path: string;
  /** What is wrong and, where useful, how to fix it. */
  message: string;
}

/** Options accepted by the {@link SoundorError} constructor. */
export interface SoundorErrorOptions {
  code: SoundorErrorCode;
  cause?: unknown;
  issues?: SoundorIssue[];
}

/**
 * The brand of every {@link SoundorError}, whichever copy of this package made
 * it. A global symbol on purpose: it names one protocol shared by every copy
 * and version (the `.v1` changes only if the protocol below does).
 */
const SOUNDOR_ERROR = Symbol.for('soundor.error.v1');

/**
 * What every Soundor error carries, whatever copy of `@soundor/core` made it:
 * the protocol {@link isSoundorError} checks. `code` is a string, since a
 * newer copy may know codes this one does not.
 */
export interface SoundorErrorInfo extends Error {
  readonly code: string;
  readonly issues: readonly SoundorIssue[];
}

/** Base for every Soundor-originated error. Carries a stable code + exit code. */
export class SoundorError extends Error implements SoundorErrorInfo {
  readonly code: SoundorErrorCode;
  readonly issues: SoundorIssue[];

  /** The cross-copy brand {@link isSoundorError} checks. */
  get [SOUNDOR_ERROR](): true {
    return true;
  }

  constructor(message: string, options: SoundorErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'SoundorError';
    this.code = options.code;
    this.issues = options.issues ?? [];
  }

  /** Process exit code this error maps to. */
  get exitCode(): number {
    return EXIT_CODES[this.code];
  }
}

/** Options for {@link RuntimeError}. */
export interface RuntimeErrorOptions {
  runtimeId?: string;
  phase?: string;
  cause?: unknown;
  issues?: SoundorIssue[];
}

/** A runtime lifecycle phase failed. */
export class RuntimeError extends SoundorError {
  readonly runtimeId?: string;
  readonly phase?: string;

  constructor(message: string, options: RuntimeErrorOptions = {}) {
    super(message, {
      code: 'RUNTIME',
      cause: options.cause,
      issues: options.issues,
    });
    this.name = 'RuntimeError';
    this.runtimeId = options.runtimeId;
    this.phase = options.phase;
  }
}

/** No runtime is registered for an id referenced by the config. */
export class UnknownRuntimeError extends SoundorError {
  readonly runtimeId: string;
  readonly available: string[];

  constructor(runtimeId: string, available: string[] = []) {
    super(
      `No runtime registered for id '${runtimeId}'.` +
        (available.length > 0
          ? ` Known runtimes: ${available.join(', ')}.`
          : ''),
      { code: 'UNKNOWN_RUNTIME' },
    );
    this.name = 'UnknownRuntimeError';
    this.runtimeId = runtimeId;
    this.available = available;
  }
}

/** A required toolchain or environment prerequisite is missing. */
export class EnvError extends SoundorError {
  constructor(
    message: string,
    options: { cause?: unknown; issues?: SoundorIssue[] } = {},
  ) {
    super(message, {
      code: 'ENV',
      cause: options.cause,
      issues: options.issues,
    });
    this.name = 'EnvError';
  }
}

/**
 * Whether `value` is a Soundor error from any copy or version of
 * `@soundor/core` (and with `code`, one with that code). Checks the protocol
 * every {@link SoundorError} carries (its brand, a string `code` and an
 * `issues` array), so an error a runtime throws from its own copy is still
 * recognized by the CLI's.
 */
export function isSoundorError(
  value: unknown,
  code?: SoundorErrorCode,
): value is SoundorErrorInfo {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<PropertyKey, unknown>;
  return (
    record[SOUNDOR_ERROR] === true &&
    typeof record['message'] === 'string' &&
    typeof record['code'] === 'string' &&
    Array.isArray(record['issues']) &&
    (code === undefined || record['code'] === code)
  );
}

/**
 * Classifies any thrown value into a stable process exit code. Recognizes every
 * Soundor error (including config's `ConfigError`, and those of other copies of
 * this package) via {@link isSoundorError} and its `code`; anything else, and a
 * code this copy does not know, maps to `INTERNAL`.
 */
export function exitCodeFor(error: unknown): number {
  if (!isSoundorError(error)) return EXIT_CODES.INTERNAL;
  return Object.hasOwn(EXIT_CODES, error.code)
    ? EXIT_CODES[error.code as SoundorErrorCode]
    : EXIT_CODES.INTERNAL;
}
