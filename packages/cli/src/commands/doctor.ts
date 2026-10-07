import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { outro, spinner } from '@clack/prompts';
import {
  ConfigError,
  MACOS_SIGNING_IDENTITY_ENV,
  parseConfig,
  resolveRuntime,
  resolveSigning,
  runPhase,
  type DoctorReport,
  type SoundorConfig,
} from '@soundor/config';
import {
  createCodegenSink,
  createConsoleLogger,
  createNodeFileSystem,
  createProjectPaths,
  probeCommand,
  rootFromConfigPath,
  type CommandProbe,
} from '@soundor/core';
import { defineCommand } from 'citty';

import { runEnvironmentChecks } from '../doctor/env';

const CONFIG_FILENAME = 'soundor.config.ts';

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export type DoctorCategory = 'environment' | 'config' | 'runtime';

/** A single, rendered diagnostic — env/config/runtime checks share this shape. */
export interface DoctorDiagnostic {
  readonly category: DoctorCategory;
  /** Set for `category: 'runtime'` — which runtime produced the check. */
  readonly runtime?: string;
  readonly label: string;
  readonly status: DoctorStatus;
  /** Why the check landed on this status. */
  readonly detail?: string;
  /** A concrete, actionable fix. */
  readonly suggestion?: string;
}

export interface RunDoctorResult {
  readonly diagnostics: DoctorDiagnostic[];
  /** Worst severity across all diagnostics. */
  readonly status: DoctorStatus;
  /** `1` when any check failed, else `0`. */
  readonly exitCode: number;
}

export interface RunDoctorOptions {
  cwd?: string;
  configPath?: string;
  /** Injectable for tests; default to the real process and toolchain. */
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  probe?: CommandProbe;
}

/**
 * Runs the full diagnostic: environment probes, config load/validation, then
 * each configured runtime's `doctor` hook. Never throws on a failing check — a
 * failure is a diagnostic, not an exception — so it works standalone (no
 * project) and inside a project alike.
 */
export async function runDoctor(
  options: RunDoctorOptions = {},
): Promise<RunDoctorResult> {
  const cwd = options.cwd ?? process.cwd();
  const diagnostics: DoctorDiagnostic[] = [];

  // 1. Environment (always, even standalone).
  for (const check of runEnvironmentChecks()) {
    diagnostics.push({ category: 'environment', ...check });
  }

  // 2. Config load + validation.
  const configPath = findConfig(cwd, options.configPath);
  if (configPath === undefined) {
    diagnostics.push({
      category: 'config',
      label: 'Config',
      status: 'warn',
      detail: `No ${CONFIG_FILENAME} found in ${resolve(cwd)} or any parent directory.`,
      suggestion: `Run inside a Soundor project, or create ${CONFIG_FILENAME}.`,
    });
    return finalize(diagnostics);
  }

  let config;
  try {
    config = await parseConfig({ path: configPath });
  } catch (error) {
    for (const diagnostic of configErrorDiagnostics(error)) {
      diagnostics.push(diagnostic);
    }
    return finalize(diagnostics);
  }

  diagnostics.push({
    category: 'config',
    label: 'Config',
    status: 'ok',
    detail: `Loaded and validated ${configPath}.`,
  });
  diagnostics.push(
    signingDiagnostic(
      config,
      options.env ?? process.env,
      options.platform ?? process.platform,
      options.probe ?? probeCommand,
    ),
  );

  // 3. Runtime doctors (delegated, aggregated — one failure never aborts the rest).
  const root = rootFromConfigPath(configPath);
  const fs = createNodeFileSystem(root);
  const logger = createConsoleLogger('soundor');
  const codegen = createCodegenSink();

  for (const entry of config.runtimes) {
    try {
      const resolved = resolveRuntime(config, entry.id);
      const report = (await runPhase(resolved, 'doctor', config, {
        paths: createProjectPaths({
          root,
          config: configPath,
          runtimeId: entry.id,
        }),
        fs,
        logger: logger.child(entry.id),
        codegen,
        mode: 'debug',
        env: options.env,
      })) as DoctorReport;

      for (const check of report.checks) {
        diagnostics.push({ category: 'runtime', runtime: entry.id, ...check });
      }
    } catch (error) {
      diagnostics.push({
        category: 'runtime',
        runtime: entry.id,
        label: `Runtime '${entry.id}'`,
        status: 'fail',
        detail: errorMessage(error),
        suggestion: `Inspect the '${entry.id}' runtime's doctor requirements.`,
      });
    }
  }

  return finalize(diagnostics);
}

export const doctorCommand = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Validate environment and project setup',
  },
  args: {
    config: {
      type: 'string',
      description: 'Path to soundor.config.ts',
    },
    json: {
      type: 'boolean',
      description: 'Emit machine-readable diagnostics as JSON',
    },
  },
  async run({ args }) {
    const configPath =
      typeof args['config'] === 'string' ? args['config'] : undefined;
    const json = args['json'] === true;

    if (json) {
      const result = await runDoctor({ configPath });
      console.log(JSON.stringify(toJsonReport(result), null, 2));
      process.exitCode = result.exitCode;
      return;
    }

    const s = spinner();
    s.start('Running diagnostics');
    const result = await runDoctor({ configPath });
    s.stop(diagnosticsSummary(result));
    outro(formatDoctorResult(result));
    process.exitCode = result.exitCode;
  },
});

/** Human-readable grouped report. */
export function formatDoctorResult(result: RunDoctorResult): string {
  const lines = ['Diagnostics'];
  for (const diagnostic of result.diagnostics) {
    const scope = diagnostic.runtime ? ` (${diagnostic.runtime})` : '';
    lines.push(
      `${glyph(diagnostic.status)} ${diagnostic.label}${scope}${
        diagnostic.detail ? `: ${diagnostic.detail}` : ''
      }`,
    );
    if (diagnostic.suggestion) {
      lines.push(`    → ${diagnostic.suggestion}`);
    }
  }
  lines.push('', diagnosticsSummary(result));
  return lines.join('\n');
}

/** Stable, machine-readable shape for `--json` / CI automation. */
export function toJsonReport(result: RunDoctorResult): {
  status: DoctorStatus;
  exitCode: number;
  checks: DoctorDiagnostic[];
} {
  return {
    status: result.status,
    exitCode: result.exitCode,
    checks: result.diagnostics,
  };
}

function finalize(diagnostics: DoctorDiagnostic[]): RunDoctorResult {
  const status = worstStatus(diagnostics);
  return {
    diagnostics,
    status,
    exitCode: status === 'fail' ? 1 : 0,
  };
}

function worstStatus(diagnostics: readonly DoctorDiagnostic[]): DoctorStatus {
  if (diagnostics.some((d) => d.status === 'fail')) return 'fail';
  if (diagnostics.some((d) => d.status === 'warn')) return 'warn';
  return 'ok';
}

function diagnosticsSummary(result: RunDoctorResult): string {
  const counts = { ok: 0, warn: 0, fail: 0 };
  for (const diagnostic of result.diagnostics) counts[diagnostic.status] += 1;
  return `${counts.ok} ok, ${counts.warn} warn, ${counts.fail} fail`;
}

function glyph(status: DoctorStatus): string {
  return status;
}

/**
 * Which identity macOS binaries are signed with, and where it came from. On
 * macOS a named identity must also be in the keychain, or the build fails.
 */
function signingDiagnostic(
  config: SoundorConfig,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  probe: CommandProbe,
): DoctorDiagnostic {
  const label = 'macOS signing';
  let signing;
  try {
    signing = resolveSigning(config, env).macos;
  } catch (error) {
    return {
      category: 'config',
      label,
      status: 'fail',
      detail:
        error instanceof ConfigError
          ? error.issues.map((issue) => issue.message).join('; ')
          : errorMessage(error),
      suggestion: `Set ${MACOS_SIGNING_IDENTITY_ENV} to the name of a certificate in your keychain.`,
    };
  }
  if (signing.source === 'default') {
    return {
      category: 'config',
      label,
      status: 'ok',
      detail: `ad-hoc (no identity set). Enough to use the plugin on this Mac; set ${MACOS_SIGNING_IDENTITY_ENV} or signing.macos.identity to distribute it.`,
    };
  }
  const from =
    signing.source === 'env'
      ? MACOS_SIGNING_IDENTITY_ENV
      : 'signing.macos.identity';
  const detail = `'${signing.identity}' (from ${from}${
    signing.keychain === undefined ? '' : `, keychain ${signing.keychain}`
  }).`;
  if (platform !== 'darwin' || signing.identity === '-') {
    return { category: 'config', label, status: 'ok', detail };
  }
  const args = ['find-identity', '-v', '-p', 'codesigning'];
  if (signing.keychain !== undefined) args.push(signing.keychain);
  const found = probe('security', args);
  if (found.ok && found.version?.includes(signing.identity)) {
    return { category: 'config', label, status: 'ok', detail };
  }
  return {
    category: 'config',
    label,
    status: 'fail',
    detail: `${detail} No valid code signing identity with that name is in the keychain.`,
    suggestion:
      'Install the certificate (with its private key) in your keychain; `security find-identity -v -p codesigning` lists the usable ones.',
  };
}

function configErrorDiagnostics(error: unknown): DoctorDiagnostic[] {
  if (error instanceof ConfigError) {
    if (error.issues.length > 0) {
      return error.issues.map((issue) => ({
        category: 'config' as const,
        label: issue.path ? `Config (${issue.path})` : 'Config',
        status: 'fail' as const,
        detail: issue.message,
        suggestion: `Fix ${issue.path || CONFIG_FILENAME} in ${CONFIG_FILENAME}.`,
      }));
    }
    return [
      {
        category: 'config',
        label: 'Config',
        status: 'fail',
        detail: error.message,
        suggestion: `Fix ${CONFIG_FILENAME}.`,
      },
    ];
  }
  return [
    {
      category: 'config',
      label: 'Config',
      status: 'fail',
      detail: errorMessage(error),
      suggestion: `Fix ${CONFIG_FILENAME}.`,
    },
  ];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Resolves the config path, returning `undefined` when none exists (standalone). */
function findConfig(cwd: string, configPath?: string): string | undefined {
  if (configPath !== undefined) {
    // An explicit path is honored as-is; a missing file surfaces as a config
    // error via parseConfig rather than a silent "standalone" fallback.
    return isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
  }
  let dir = resolve(cwd);
  for (;;) {
    const candidate = resolve(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
