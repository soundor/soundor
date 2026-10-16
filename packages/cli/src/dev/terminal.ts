import { createWriteStream, type WriteStream } from 'node:fs';
import { styleText } from 'node:util';

import type { DevSummaryRow } from '@soundor/config';
import { createConsoleLogger, type Logger } from '@soundor/core';

/** How many lines of collapsed build output a failure prints. */
const FAILURE_LINES = 200;

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export interface DevTerminalOptions {
  /** The root logger scope, e.g. `soundor`. */
  scope: string;
  /** Every line of child-process output is kept here. */
  buildLog: string;
  /**
   * Collapse child-process output into one line that rewrites itself, instead
   * of printing all of it. Only for a terminal.
   */
  collapse: boolean;
  output?: NodeJS.WriteStream;
}

/**
 * The terminal side of `soundor dev`: a {@link Logger} whose child-process
 * output (the native build) goes to a log file, and in a terminal collapses
 * into a single progress line, so the summary printed when the runtime is
 * ready stays on screen.
 */
export interface DevTerminal {
  readonly logger: Logger;
  /** Prints text as is, after taking down the progress line. */
  print(text: string): void;
  /** The build finished: drops the progress line and its collapsed output. */
  settle(): void;
  /** The build failed: prints the collapsed output it hid. */
  flush(): void;
  close(): Promise<void>;
}

export function createDevTerminal(options: DevTerminalOptions): DevTerminal {
  const output = options.output ?? process.stdout;
  const log: WriteStream = createWriteStream(options.buildLog);
  // Without a listener, a failure to write the log would end the process.
  log.on('error', () => {});
  let hidden: string[] = [];
  let progress = false;

  const clearProgress = (): void => {
    if (!progress) return;
    output.write('\r\x1b[2K');
    progress = false;
  };
  const showProgress = (line: string): void => {
    const width = Math.max((output.columns || 80) - 3, 10);
    const text = line.length > width ? `${line.slice(0, width - 1)}…` : line;
    output.write(
      `\r\x1b[2K${styleText('dim', `… ${text}`, { stream: output })}`,
    );
    progress = true;
  };

  const wrap = (inner: Logger): Logger => {
    const logger = {} as Logger;
    for (const level of LEVELS) {
      logger[level] = (message, ...args) => {
        clearProgress();
        inner[level](message, ...args);
      };
    }
    logger.pipe = (message, stream) => {
      log.write(`${message}\n`);
      if (!options.collapse) {
        inner.pipe(message, stream);
        return;
      }
      const lines = stripAnsi(message).split('\n');
      hidden.push(...lines);
      if (hidden.length > FAILURE_LINES) hidden = hidden.slice(-FAILURE_LINES);
      const last = lines.filter((line) => line.trim().length > 0).at(-1);
      if (last !== undefined) showProgress(last.trim());
    };
    logger.child = (scope) => wrap(inner.child(scope));
    return logger;
  };
  const root = createConsoleLogger(options.scope);
  const logger = wrap(root);

  return {
    logger,
    print(text) {
      clearProgress();
      console.info(text);
    },
    settle() {
      clearProgress();
      hidden = [];
    },
    flush() {
      clearProgress();
      if (hidden.length === 0) return;
      root.pipe(hidden.join('\n'), 'stderr');
      hidden = [];
      root.error(`The full build output is in ${options.buildLog}`);
    },
    close() {
      clearProgress();
      return new Promise((resolve) => log.end(resolve));
    },
  };
}

export interface SummaryOptions {
  version?: string;
  runtime: string;
  /** Time from starting to ready, for the first summary. */
  readyMs?: number;
  rows: readonly DevSummaryRow[];
  /** Mention the shortcuts (only when they are bound). */
  hint: boolean;
  output?: NodeJS.WriteStream;
}

/** The `soundor dev` summary, in the style of Vite's. */
export function formatSummary(options: SummaryOptions): string {
  const stream = options.output ?? process.stdout;
  const paint = (format: Parameters<typeof styleText>[0], text: string) =>
    styleText(format, text, { stream });
  const width = Math.max(...options.rows.map((row) => row.label.length)) + 1;
  const arrow = paint('green', '➜');
  const lines = options.rows.map(
    (row) =>
      `  ${arrow}  ${paint('bold', `${row.label}:`.padEnd(width))}  ${
        /^https?:\/\//.test(row.value) ? paint('cyan', row.value) : row.value
      }`,
  );
  if (options.hint)
    lines.push(
      `  ${paint('green', '➜')}  ${paint('dim', 'press')} ${paint('bold', 'h + enter')} ${paint('dim', 'to show help')}`,
    );
  const title = [
    paint(['bold', 'green'], 'SOUNDOR'),
    options.version === undefined ? '' : paint('green', `v${options.version}`),
    paint('dim', `dev · ${options.runtime}`),
  ]
    .filter((part) => part.length > 0)
    .join('  ');
  const ready =
    options.readyMs === undefined
      ? ''
      : `  ${paint('dim', 'ready in')} ${paint('bold', formatDuration(options.readyMs))}`;
  return `\n  ${title}${ready}\n\n${lines.join('\n')}\n`;
}

function formatDuration(milliseconds: number): string {
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1000).toFixed(1)} s`;
}

function stripAnsi(text: string): string {
  // oxlint-disable-next-line no-control-regex
  return text.replaceAll(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replaceAll('\r', '');
}
