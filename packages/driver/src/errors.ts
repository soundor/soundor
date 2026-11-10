import type { DebugError } from '@soundor/devtools-protocol';

/**
 * Why a Driver operation failed. Stable: scripts and the CLI branch on it.
 * Messages say what to do; they never contain credentials.
 */
export type DriverErrorCode =
  /** The options or arguments are invalid. */
  | 'INVALID_OPTIONS'
  /** The session descriptor is missing, unprotected or malformed. */
  | 'INVALID_DESCRIPTOR'
  /** The server rejected the browser key or the connection. */
  | 'AUTHENTICATION_FAILED'
  /** No DevTools server answers at the endpoint. */
  | 'SERVER_UNAVAILABLE'
  /** The connection to the server closed. */
  | 'DISCONNECTED'
  /** The session has no running Soundor instance. */
  | 'NO_TARGETS'
  /** No instance has the requested ID or name. */
  | 'TARGET_NOT_FOUND'
  /** Several instances run and none was selected. */
  | 'AMBIGUOUS_TARGET'
  /** The selected instance disconnected; it is never replaced by another. */
  | 'TARGET_DISCONNECTED'
  /** The instance reloaded while the operation ran. */
  | 'GENERATION_CHANGED'
  /** A node reference is from an earlier generation, or the node was removed. */
  | 'STALE_NODE'
  /** The instance is busy with another interactive command. */
  | 'BUSY'
  /** The instance does not support the operation. */
  | 'MISSING_CAPABILITY'
  /** No node matches the locator. */
  | 'ELEMENT_NOT_FOUND'
  /** Several nodes match a locator that must match one. */
  | 'AMBIGUOUS_ELEMENT'
  /**
   * The node cannot take the input: hidden, disabled, without size, outside
   * the view, covered by another node, or not focusable.
   */
  | 'ELEMENT_NOT_ACTIONABLE'
  /** The instance cannot capture its view, or the capture was lost. */
  | 'SCREENSHOT_UNAVAILABLE'
  /** The operation did not finish in time. */
  | 'TIMEOUT'
  /** The operation was cancelled. */
  | 'CANCELLED'
  /** The server or instance sent something the protocol does not allow. */
  | 'PROTOCOL'
  /** The instance failed while handling the operation. */
  | 'INTERNAL';

/**
 * The brand of every {@link DriverError}, whichever copy of this package made
 * it: `@soundor/vitest-e2e` throws from its own copy, which a test's
 * `isDriverError` (from another) still recognizes.
 */
const DRIVER_ERROR = Symbol.for('soundor.driver-error.v1');

export class DriverError extends Error {
  override readonly name = 'DriverError';
  /** The cross-copy brand {@link isDriverError} checks. */
  get [DRIVER_ERROR](): true {
    return true;
  }
  constructor(
    readonly code: DriverErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * Whether `error` is a {@link DriverError} of any copy of this package (and
 * with `code`, one with that code): it carries the Driver's brand and a
 * string `code`. Not `instanceof`, which holds only within one copy.
 */
export function isDriverError(
  error: unknown,
  code?: DriverErrorCode,
): error is DriverError {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<PropertyKey, unknown>;
  return (
    record[DRIVER_ERROR] === true &&
    typeof record['code'] === 'string' &&
    (code === undefined || record['code'] === code)
  );
}

const PROTOCOL_CODES: Record<DebugError['code'], DriverErrorCode> = {
  INVALID_REQUEST: 'INVALID_OPTIONS',
  UNAUTHORIZED: 'AUTHENTICATION_FAILED',
  PROTOCOL_MISMATCH: 'PROTOCOL',
  TARGET_GONE: 'TARGET_DISCONNECTED',
  STALE_NODE: 'STALE_NODE',
  MISSING_CAPABILITY: 'MISSING_CAPABILITY',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  BUSY: 'BUSY',
  NOT_ACTIONABLE: 'ELEMENT_NOT_ACTIONABLE',
  CAPTURE_UNAVAILABLE: 'SCREENSHOT_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
};

/** A protocol error from the server or the native instance. */
export function fromProtocolError(error: DebugError, method: string) {
  return new DriverError(
    PROTOCOL_CODES[error.code],
    `${method}: ${error.message}`,
  );
}
