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
  /** Another client controls the instance. */
  | 'LEASE_BUSY'
  /** The operation needs control of the instance, which this client lacks. */
  | 'LEASE_REQUIRED'
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
  /** The operation did not finish in time. */
  | 'TIMEOUT'
  /** The operation was cancelled. */
  | 'CANCELLED'
  /** The server or instance sent something the protocol does not allow. */
  | 'PROTOCOL'
  /** The instance failed while handling the operation. */
  | 'INTERNAL';

export class DriverError extends Error {
  override readonly name = 'DriverError';
  constructor(
    readonly code: DriverErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export function isDriverError(
  error: unknown,
  code?: DriverErrorCode,
): error is DriverError {
  return (
    error instanceof DriverError && (code === undefined || error.code === code)
  );
}

const PROTOCOL_CODES: Record<DebugError['code'], DriverErrorCode> = {
  INVALID_REQUEST: 'INVALID_OPTIONS',
  UNAUTHORIZED: 'AUTHENTICATION_FAILED',
  PROTOCOL_MISMATCH: 'PROTOCOL',
  TARGET_GONE: 'TARGET_DISCONNECTED',
  STALE_NODE: 'STALE_NODE',
  MISSING_CAPABILITY: 'MISSING_CAPABILITY',
  LEASE_BUSY: 'LEASE_BUSY',
  LEASE_REQUIRED: 'LEASE_REQUIRED',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  BUSY: 'BUSY',
  NOT_ACTIONABLE: 'ELEMENT_NOT_ACTIONABLE',
  INTERNAL: 'INTERNAL',
};

/** A protocol error from the server or the native instance. */
export function fromProtocolError(error: DebugError, method: string) {
  return new DriverError(
    PROTOCOL_CODES[error.code],
    `${method}: ${error.message}`,
  );
}
