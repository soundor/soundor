/** Codes the host reports, and the client's own. */
export type Vst3HostErrorCode =
  // The plugin or the request (from the host).
  | 'plugin-not-found'
  | 'invalid-bundle'
  | 'incompatible-architecture'
  | 'load-failed'
  | 'unsupported-plugin'
  | 'no-matching-class'
  | 'ambiguous-class'
  | 'initialization-failed'
  | 'unsupported-configuration'
  | 'unknown-parameter'
  | 'plugin-error'
  | 'no-editor'
  | 'no-display'
  | 'headless'
  | 'audio-unavailable'
  | 'invalid-request'
  | 'invalid-state'
  | 'unknown-method'
  | 'message-too-large'
  | 'internal-error'
  // The process and the protocol (from the client).
  | 'host-exited'
  | 'timeout'
  | 'aborted'
  | 'closed'
  | 'protocol-error'
  | 'incompatible-host'
  | 'executable-not-found'
  | 'platform-package-missing'
  | 'unsupported-platform'
  | 'selection-failed';

export class Vst3HostError extends Error {
  override readonly name = 'Vst3HostError';
  readonly code: Vst3HostErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(
    code: Vst3HostErrorCode,
    message: string,
    details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.details = details;
  }
}
