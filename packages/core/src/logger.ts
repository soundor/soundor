/**
 * Structured, scope-able logging. The interface is the seam every runtime logs
 * through; {@link createConsoleLogger} is the default console-backed host impl.
 */

/** A structured logger. Hosts provide the implementation. */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  /** Child logger that prefixes every record with `scope`. */
  child(scope: string): Logger;
}

/** Levels a {@link Logger} emits, mapped to their console method. */
const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/**
 * A {@link Logger} backed by the global `console`. When `scope` is set, every
 * record is prefixed with `[scope]`; `child` appends nested scopes with `:`.
 */
export function createConsoleLogger(scope?: string): Logger {
  const prefix = scope ? `[${scope}] ` : '';
  const logger = {} as Logger;
  for (const level of LEVELS) {
    logger[level] = (message: string, ...args: unknown[]): void => {
      console[level](`${prefix}${message}`, ...args);
    };
  }
  logger.child = (childScope: string): Logger =>
    createConsoleLogger(scope ? `${scope}:${childScope}` : childScope);
  return logger;
}
