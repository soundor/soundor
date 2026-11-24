/**
 * `soundor licenses`: the third-party notices each runtime's build would
 * ship in its `licenses/`, without building it. The UI is bundled (what it
 * contains decides its notices) and each runtime reports the rest: its
 * prebuilt parts, the crates Cargo resolves for its target.
 */
import { resolve } from 'node:path';

import { outro } from '@clack/prompts';
import {
  parseConfig,
  resolveRuntime,
  runPhase,
  type LicensesReport,
} from '@soundor/config';
import {
  createCodegenSink,
  createConsoleLogger,
  createNodeFileSystem,
  createProjectPaths,
  describeNotice,
  noticeManifest,
  rootFromConfigPath,
  sortNotices,
  summarizeNotices,
} from '@soundor/core';
import { defineCommand } from 'citty';

import { libraryBuildContext } from '../library/cargo';
import { bundleUi } from '../ui/bundle';
import { resolveConfigPath } from './build';
import { runGen } from './gen';

export interface RunLicensesOptions {
  cwd?: string;
  configPath?: string;
  runtime?: string;
}

export interface RunLicensesResult {
  /** By runtime id; undefined for a runtime that reports none. */
  readonly runtimes: readonly {
    readonly runtime: string;
    readonly report: LicensesReport | undefined;
  }[];
}

export async function runLicenses(
  options: RunLicensesOptions = {},
): Promise<RunLicensesResult> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd, options.configPath);
  const root = rootFromConfigPath(configPath);
  const config = await parseConfig({ path: configPath });
  const resolvedRuntimes = (
    options.runtime ? [options.runtime] : config.runtimes.map(({ id }) => id)
  ).map((id) => resolveRuntime(config, id));
  await runGen({
    cwd,
    configPath,
    mode: 'production',
    runtimeIds: resolvedRuntimes.map((resolved) => resolved.config.id),
  });

  const fs = createNodeFileSystem(root);
  const logger = createConsoleLogger('soundor');
  // What a release build bundles, in its own directory: a build or `dev`
  // may be using theirs.
  const bundle = await bundleUi({
    root,
    mode: 'production',
    env: config.env,
    outDir: resolve(root, '.soundor', 'ui', 'licenses'),
  });
  const runtimes: RunLicensesResult['runtimes'][number][] = [];
  for (const resolved of resolvedRuntimes) {
    const id = resolved.config.id;
    const report = (await runPhase(resolved, 'licenses', config, {
      paths: createProjectPaths({ root, config: configPath, runtimeId: id }),
      fs,
      logger: logger.child(id),
      codegen: createCodegenSink(),
      mode: 'production',
      ui: bundle && { dir: bundle.dir, module: bundle.module },
      lib: libraryBuildContext(root, logger.child(id)),
    })) as LicensesReport | undefined;
    runtimes.push({ runtime: id, report });
  }
  return { runtimes };
}

/** The report as text: each runtime's components, then what to fix. */
export function formatLicenses(result: RunLicensesResult): string {
  const lines: string[] = [];
  for (const { runtime, report } of result.runtimes) {
    if (lines.length > 0) lines.push('');
    if (report === undefined) {
      lines.push(`${runtime}: reports no third-party notices`);
      continue;
    }
    lines.push(`${runtime}: ${summarizeNotices(report.notices)}`);
    for (const notice of sortNotices(report.notices)) {
      const origin =
        notice.origin === 'found'
          ? ''
          : ` [${notice.origin} in soundor.config.ts]`;
      lines.push(`  ${notice.directory}  ${describeNotice(notice)}${origin}`);
    }
    for (const path of report.unused)
      lines.push(`  ${path} matches nothing in the build`);
  }
  return lines.join('\n');
}

export const licensesCommand = defineCommand({
  meta: {
    name: 'licenses',
    description:
      "List the third-party notices each runtime's build ships, without building it",
  },
  args: {
    runtime: {
      type: 'positional',
      description: 'Runtime to report (all if omitted)',
      required: false,
    },
    config: {
      type: 'string',
      description: 'Path to soundor.config.ts',
    },
    json: {
      type: 'boolean',
      description: "Print each runtime's licenses.json instead",
    },
  },
  async run({ args }) {
    const result = await runLicenses({
      runtime:
        typeof args['runtime'] === 'string' ? args['runtime'] : undefined,
      configPath:
        typeof args['config'] === 'string' ? args['config'] : undefined,
    });
    if (args['json'] === true) {
      console.log(
        JSON.stringify(
          Object.fromEntries(
            result.runtimes.map(({ runtime, report }) => [
              runtime,
              report === undefined
                ? null
                : { ...noticeManifest(report.notices), unused: report.unused },
            ]),
          ),
          null,
          2,
        ),
      );
      return;
    }
    outro(formatLicenses(result));
  },
});
