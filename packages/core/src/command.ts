/**
 * Host process helpers shared by runtimes: a synchronous version probe (for
 * `doctor`-style toolchain checks) and an async, cancellable command runner (for
 * long-lived `dev`/`build` phases). Both are injectable — see {@link
 * CommandProbe}/{@link CommandRunner} — so callers can be unit-tested without the
 * real toolchain present.
 */

import { spawn, spawnSync } from 'node:child_process';

import type { Logger } from './logger';

/** Outcome of a `<cmd> --version`-style probe. Never throws. */
export interface ProbeResult {
  /** Whether the command ran and exited 0. */
  readonly ok: boolean;
  /** Trimmed stdout (typically the version), when available. */
  readonly version?: string;
  /** Why the probe failed, when it did. */
  readonly error?: string;
}

/** A synchronous command probe, injectable for tests. */
export type CommandProbe = (cmd: string, args?: string[]) => ProbeResult;

/**
 * Spawns `cmd` with `args` and reports whether it succeeded. A missing binary or
 * non-zero exit is returned as `{ ok: false, error }` rather than thrown.
 */
export const probeCommand: CommandProbe = (cmd, args = []) => {
  try {
    const result = spawnSync(cmd, args, {
      encoding: 'utf8',
      // Windows resolves shims (e.g. `pnpm`) via the shell.
      shell: process.platform === 'win32',
    });
    if (result.error) return { ok: false, error: result.error.message };
    if (result.status !== 0) {
      const stderr = (result.stderr ?? '').trim();
      return {
        ok: false,
        error: stderr || `${cmd} exited with code ${result.status ?? 'null'}`,
      };
    }
    return { ok: true, version: (result.stdout ?? '').trim() || undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export interface RunCommandOptions {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly logger: Logger;
  readonly signal?: AbortSignal;
}

/** Thrown when a spawned command exits non-zero or cannot start. */
export class CommandFailedError extends Error {
  readonly cmd: string;
  readonly code: number | null;

  constructor(cmd: string, code: number | null, detail?: string) {
    super(
      `Command '${cmd}' failed${code === null ? '' : ` with exit code ${code}`}${
        detail ? `: ${detail}` : '.'
      }`,
    );
    this.name = 'CommandFailedError';
    this.cmd = cmd;
    this.code = code;
  }
}

/** An async, cancellable command runner, injectable for tests. */
export type CommandRunner = (options: RunCommandOptions) => Promise<void>;

/**
 * Runs a command to completion, streaming stdout/stderr to the logger. Rejects
 * with {@link CommandFailedError} on non-zero exit and honors `signal`.
 */
export const runCommand: CommandRunner = ({ cmd, args, cwd, logger, signal }) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CommandFailedError(cmd, null, 'aborted before start'));
      return;
    }
    const child = spawn(cmd, [...args], {
      cwd,
      signal,
      shell: process.platform === 'win32',
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      logger.info(chunk.toString('utf8').trimEnd());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      logger.warn(chunk.toString('utf8').trimEnd());
    });
    child.on('error', (error) => {
      reject(new CommandFailedError(cmd, null, error.message));
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new CommandFailedError(cmd, code));
    });
  });
