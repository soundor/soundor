import type { Capability, DebugTarget } from '@soundor/devtools-protocol';

export interface DevToolsServerOptions {
  projectRoot: string;
  port?: number;
  /** Try following ports on collision. The CLI enables this for its default port. */
  portFallback?: boolean;
  /** Omit to run the complete backend without a frontend. */
  staticDir?: string;
  /** Explicit loopback frontend origin, for a local development proxy only. */
  developmentOrigin?: string;
  signal?: AbortSignal;
  commandTimeout?: number;
  heartbeatTimeout?: number;
  targetTimeout?: number;
  onTarget?: (target: DebugTarget) => void;
  /** Static runtime declaration; connected instances may negotiate a subset. */
  supportedCapabilities?: readonly Capability[];
}
export interface DevToolsConnection {
  readonly endpoint: string;
  readonly sessionId: string;
  readonly token: string;
  readonly descriptorPath?: string;
}
export interface DevToolsServer {
  readonly url: string;
  readonly connection: DevToolsConnection;
  readonly descriptorPath: string;
  /** One-use browser bootstrap ticket; never print this URL in logs. */
  browserLaunchUrl(): string;
  publishLog(entry: {
    level: 'debug' | 'info' | 'warn' | 'error';
    source: string;
    message: string;
  }): void;
  close(): Promise<void>;
}

export class DevToolsPortError extends Error {}
