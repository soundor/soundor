import {
  connect,
  DriverError,
  isDriverError,
  type Driver,
  type DriverErrorCode,
} from '@soundor/driver';

/**
 * Exit codes of `soundor driver` commands: stable, for scripts and agents.
 * 1 is any other failure.
 */
export const DRIVER_EXIT_CODES = {
  /** Invalid arguments or options, or several targets and none selected. */
  invalid: 2,
  /** The browser key was rejected, or the session descriptor is unusable. */
  authentication: 3,
  /** No server, no target, or the target disconnected or reloaded. */
  unavailable: 4,
  /** No node, several nodes, or a stale node for a query. */
  element: 5,
  /** Another client controls the target, or it is busy. */
  lease: 6,
  /** The command timed out or was cancelled. */
  timeout: 7,
  /** The target does not support the operation. */
  unsupported: 8,
  /** Anything else. */
  internal: 1,
} as const;

const EXIT_CODES: Record<DriverErrorCode, number> = {
  INVALID_OPTIONS: DRIVER_EXIT_CODES.invalid,
  AMBIGUOUS_TARGET: DRIVER_EXIT_CODES.invalid,
  INVALID_DESCRIPTOR: DRIVER_EXIT_CODES.authentication,
  AUTHENTICATION_FAILED: DRIVER_EXIT_CODES.authentication,
  SERVER_UNAVAILABLE: DRIVER_EXIT_CODES.unavailable,
  DISCONNECTED: DRIVER_EXIT_CODES.unavailable,
  NO_TARGETS: DRIVER_EXIT_CODES.unavailable,
  TARGET_NOT_FOUND: DRIVER_EXIT_CODES.unavailable,
  TARGET_DISCONNECTED: DRIVER_EXIT_CODES.unavailable,
  GENERATION_CHANGED: DRIVER_EXIT_CODES.unavailable,
  ELEMENT_NOT_FOUND: DRIVER_EXIT_CODES.element,
  AMBIGUOUS_ELEMENT: DRIVER_EXIT_CODES.element,
  STALE_NODE: DRIVER_EXIT_CODES.element,
  LEASE_BUSY: DRIVER_EXIT_CODES.lease,
  LEASE_REQUIRED: DRIVER_EXIT_CODES.lease,
  BUSY: DRIVER_EXIT_CODES.lease,
  TIMEOUT: DRIVER_EXIT_CODES.timeout,
  CANCELLED: DRIVER_EXIT_CODES.timeout,
  MISSING_CAPABILITY: DRIVER_EXIT_CODES.unsupported,
  PROTOCOL: DRIVER_EXIT_CODES.internal,
  INTERNAL: DRIVER_EXIT_CODES.internal,
};

/** The options every `soundor driver` command takes. */
export const connectionArgs = {
  descriptor: {
    type: 'string',
    description:
      'DevTools session descriptor (soundor dev prints "DevTools session file"); default $SOUNDOR_DEVTOOLS_SESSION',
  },
  endpoint: {
    type: 'string',
    description:
      'Session endpoint http://127.0.0.1:<port> instead of a descriptor; the key comes from $SOUNDOR_DEVTOOLS_BROWSER_KEY',
  },
  target: {
    type: 'string',
    description: 'Target ID, when several instances run (see: targets)',
  },
  'target-name': {
    type: 'string',
    description: 'Target plugin name, when it is unique',
  },
  json: {
    type: 'boolean',
    description: 'Print the result as JSON on stdout; errors as JSON on stderr',
  },
  timeout: {
    type: 'string',
    description: 'How long each step may take: 500ms, 5s, 1m (default 10s)',
  },
} as const;

export interface ConnectionArgs {
  descriptor?: string | undefined;
  endpoint?: string | undefined;
  target?: string | undefined;
  'target-name'?: string | undefined;
  json?: boolean | undefined;
  timeout?: string | undefined;
}

/** Milliseconds from `500ms`, `5s`, `1m` or a plain number of milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(value.trim());
  const amount = match ? Number(match[1]) : NaN;
  const milliseconds =
    amount * (match?.[2] === 's' ? 1000 : match?.[2] === 'm' ? 60000 : 1);
  if (!(milliseconds > 0) || !Number.isFinite(milliseconds))
    throw new DriverError(
      'INVALID_OPTIONS',
      `Invalid duration "${value}": use 500ms, 5s or 1m`,
    );
  return Math.round(milliseconds);
}

export interface Output {
  stdout(text: string): void;
  stderr(text: string): void;
}

const processOutput: Output = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export interface DriverCommand<P, T> {
  /** Reads the command's own arguments, before connecting. */
  parse(): P;
  work(driver: Driver, params: P): Promise<T>;
  /** The human-readable result; `--json` prints the result itself. */
  print(result: T): string;
}

/**
 * Runs one command: connect, work, print, and always disconnect (releasing
 * any control). Returns the exit code, which it also sets on the process.
 */
export async function runDriverCommand<P, T>(
  args: ConnectionArgs,
  command: DriverCommand<P, T>,
  output: Output = processOutput,
): Promise<number> {
  const json = args.json === true;
  let driver: Driver | undefined;
  const interrupt = () => void driver?.disconnect();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let code = 0;
  try {
    const params = command.parse();
    const timeout =
      args.timeout === undefined ? undefined : parseDuration(args.timeout);
    driver = await connect({
      ...(args.descriptor === undefined
        ? {}
        : { descriptorPath: args.descriptor }),
      ...(args.endpoint === undefined ? {} : { endpoint: args.endpoint }),
      ...(args.target === undefined ? {} : { targetId: args.target }),
      ...(args['target-name'] === undefined
        ? {}
        : { targetName: args['target-name'] }),
      ...(timeout === undefined ? {} : { timeout, connectTimeout: timeout }),
    });
    const result = await command.work(driver, params);
    output.stdout(
      json
        ? JSON.stringify(result, null, 2) + '\n'
        : command.print(result) + '\n',
    );
  } catch (error) {
    const driverError = isDriverError(error)
      ? error
      : new DriverError(
          'INTERNAL',
          error instanceof Error ? error.message : String(error),
        );
    code = EXIT_CODES[driverError.code];
    output.stderr(
      json
        ? JSON.stringify({
            error: { code: driverError.code, message: driverError.message },
          }) + '\n'
        : `soundor driver: ${driverError.message} (${driverError.code})\n`,
    );
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    await driver?.disconnect();
  }
  process.exitCode = code;
  return code;
}

/** A required argument citty leaves optional, so a missing one exits 2. */
export function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '')
    throw new DriverError('INVALID_OPTIONS', `Missing ${name}`);
  return value;
}
