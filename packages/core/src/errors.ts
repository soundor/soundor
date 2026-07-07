/**
 * Shared error taxonomy for every Soundor package.
 *
 * A single base ({@link SoundorError}) carries a machine-stable {@link
 * SoundorErrorCode}; each code maps to a fixed process exit code via {@link
 * EXIT_CODES}. Downstream packages subclass the base (e.g. `ConfigError` in
 * `@soundor/config`) so a CLI can classify any thrown value with {@link
 * exitCodeFor} and exit deterministically.
 */

/** Machine-stable error codes. Each maps to a fixed CLI exit code. */
export type SoundorErrorCode =
  | 'CONFIG'
  | 'ENV'
  | 'UNKNOWN_RUNTIME'
  | 'INVALID_RUNTIME'
  | 'RUNTIME'
  | 'INTERNAL';

/** Stable, documented process exit codes — one per {@link SoundorErrorCode}. */
export const EXIT_CODES: Readonly<Record<SoundorErrorCode, number>> = {
  CONFIG: 2,
  ENV: 3,
  UNKNOWN_RUNTIME: 4,
  INVALID_RUNTIME: 4,
  RUNTIME: 5,
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

/** Base for every Soundor-originated error. Carries a stable code + exit code. */
export class SoundorError extends Error {
  readonly code: SoundorErrorCode;
  readonly issues: SoundorIssue[];

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
 * Classifies any thrown value into a stable process exit code. Recognizes every
 * {@link SoundorError} subclass (including config's `ConfigError`) via its
 * `code`; anything else maps to `INTERNAL`.
 */
export function exitCodeFor(error: unknown): number {
  if (error instanceof SoundorError) return error.exitCode;
  return EXIT_CODES.INTERNAL;
}
