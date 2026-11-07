import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import type { PackageManager } from './pm';
import { PACKAGE_MANAGER_FILES, type Manifest } from './scaffold';
import {
  activeReleaseGroups,
  compareVersions,
  stableVersion,
  TEMPLATE_RELEASE_GROUPS,
  type ReleaseGroup,
} from './template-support';

const execute = promisify(execFile);

export type RunPackageManager = (
  args: readonly string[],
  cwd: string,
) => Promise<string>;

export class PackageManagerError extends Error {
  constructor(readonly output: string) {
    super(output);
  }
}

export function packageManagerRunner(pm: PackageManager): RunPackageManager {
  return async (args, cwd) => {
    try {
      const result = await execute(pm, [...args], {
        cwd,
        maxBuffer: 8 * 1024 * 1024,
        // Fixed arguments, package names from the template, and validated
        // version numbers only; the project path is passed through cwd.
        shell: process.platform === 'win32',
      });
      return result.stdout;
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      throw new PackageManagerError(
        [failure.stdout, failure.stderr].filter(Boolean).join('\n') ||
          failure.message,
      );
    }
  };
}

/** A missing version or an age-filtered version may become ready later. */
export function isReadinessFailure(
  error: unknown,
): error is PackageManagerError {
  if (!(error instanceof PackageManagerError)) return false;
  return /\b(?:ETARGET|E404|ERR_PNPM_NO_MATCHING_VERSION|ERR_PNPM_FETCH_404|ERR_PNPM_MINIMUM_RELEASE_AGE)\b|minimum.?release.?age|release.age|not old enough/i.test(
    error.output,
  );
}

export function installArguments(pm: PackageManager): string[] {
  return pm === 'pnpm'
    ? [
        'install',
        '--config.recursiveInstall=false',
        '--config.sharedWorkspaceLockfile=false',
      ]
    : ['install'];
}

export function resolutionArguments(pm: PackageManager): string[] {
  return [
    ...installArguments(pm),
    pm === 'pnpm' ? '--lockfile-only' : '--package-lock-only',
    '--ignore-scripts',
    ...(pm === 'pnpm' ? ['--no-frozen-lockfile'] : ['--no-audit', '--no-fund']),
  ];
}

export function lockfileName(pm: PackageManager): string {
  return pm === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json';
}

export interface Resolution {
  readonly versions: Readonly<Record<string, string>>;
  readonly lockfile: string;
}

/**
 * Resolve the whole graph with the user's package manager. Scratch projects
 * are siblings of the destination, so ancestor/global settings and workspace
 * membership patterns match. For '.', preserve its local PM configuration.
 * No destination files are removed or generated until this succeeds.
 */
export async function resolveProjectDependencies(options: {
  pm: PackageManager;
  targetDir: string;
  currentDirectory: boolean;
  manifest: Manifest;
  golden: Readonly<Record<string, string>>;
  groups?: readonly ReleaseGroup[];
  run?: RunPackageManager;
}): Promise<Resolution> {
  const { pm, targetDir, currentDirectory, manifest, golden } = options;
  const run = options.run ?? packageManagerRunner(pm);
  const parent = currentDirectory ? targetDir : dirname(targetDir);
  await mkdir(parent, { recursive: true });
  const scratch = await mkdtemp(join(parent, '.soundor-create-'));
  try {
    if (currentDirectory) {
      for (const name of PACKAGE_MANAGER_FILES) {
        const source = join(targetDir, name);
        if (existsSync(source)) await copyFile(source, join(scratch, name));
      }
    }
    const selected = await selectVersions({
      golden,
      groups: options.groups ?? TEMPLATE_RELEASE_GROUPS,
      published: async (name) => {
        try {
          const output = await run(
            ['view', name, 'versions', '--json'],
            scratch,
          );
          const versions: unknown = JSON.parse(output);
          if (typeof versions === 'string') return [versions];
          if (
            Array.isArray(versions) &&
            versions.every((version) => typeof version === 'string')
          ) {
            return versions as string[];
          }
          throw new Error(`Unexpected versions response for ${name}`);
        } catch (error) {
          if (isReadinessFailure(error)) return [];
          throw error;
        }
      },
      resolve: async (versions) => {
        // Always start with a fresh lockfile: a rejected attempt must not
        // bias resolution of the next candidate.
        await rm(join(scratch, lockfileName(pm)), { force: true });
        const candidate = { ...manifest };
        for (const field of ['dependencies', 'devDependencies'] as const) {
          candidate[field] = Object.fromEntries(
            Object.entries(manifest[field] ?? {}).map(([name, specifier]) => [
              name,
              versions[name] ?? specifier,
            ]),
          );
        }
        await writeFile(
          join(scratch, 'package.json'),
          JSON.stringify(candidate, null, 2) + '\n',
        );
        await run(resolutionArguments(pm), scratch);
      },
    });
    return {
      versions: selected,
      lockfile: await readFile(join(scratch, lockfileName(pm)), 'utf-8'),
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Prefer the fixed group, then JUCE, Web and host, newest first in each. */
export async function selectVersions(options: {
  golden: Readonly<Record<string, string>>;
  groups: readonly ReleaseGroup[];
  published: (name: string) => Promise<readonly string[]>;
  resolve: (versions: Readonly<Record<string, string>>) => Promise<void>;
}): Promise<Readonly<Record<string, string>>> {
  const { golden, published, resolve } = options;
  const groups = activeReleaseGroups(golden, options.groups);
  let lastFailure: PackageManagerError;
  try {
    await resolve(golden);
    return golden;
  } catch (error) {
    if (!isReadinessFailure(error)) throw error;
    lastFailure = error;
  }

  const candidates = await Promise.all(
    groups.map(async (group) => {
      const upper = golden[group.packages[0]!]!;
      if (upper === group.minimum) return [upper];
      const releases = await Promise.all(
        group.packages.map((name) => published(name)),
      );
      const older = releases[0]!.filter(
        (version) =>
          stableVersion(version) !== undefined &&
          compareVersions(version, group.minimum) >= 0 &&
          compareVersions(version, upper) < 0 &&
          releases.every((versions) => versions.includes(version)),
      );
      return [upper, ...new Set(older.sort((a, b) => compareVersions(b, a)))];
    }),
  );

  for (const versions of combinations(groups, candidates, golden)) {
    if (Object.keys(golden).every((name) => versions[name] === golden[name]))
      continue;
    try {
      await resolve(versions);
      return versions;
    } catch (error) {
      if (
        error instanceof PackageManagerError &&
        /\b(?:ERESOLVE|ERR_PNPM_PEER_DEP_ISSUES)\b/.test(error.output)
      ) {
        lastFailure = error;
        continue;
      }
      if (!isReadinessFailure(error)) throw error;
      lastFailure = error;
    }
  }

  if (!isReadinessFailure(lastFailure)) throw lastFailure;

  const bounds = groups
    .map(
      (group) =>
        `${group.packages.join(', ')}: ${group.minimum} through ${golden[group.packages[0]!]}`,
    )
    .join('\n');
  const ageBlocked =
    /minimum.?release.?age|release.age|not old enough|too new|before/i.test(
      lastFailure.output,
    );
  throw new Error(
    [
      'No supported dependency combination is ready for this template.',
      bounds,
      ageBlocked
        ? "Required packages do not satisfy the package manager's release-age policy. Wait, or explicitly change your policy and try again."
        : 'Required package versions are unavailable under the current registry and policy. They may still be awaiting publication or registry checks. Try again later; changing an age policy cannot make an unpublished package available.',
      lastFailure.output,
    ].join('\n\n'),
  );
}

function* combinations(
  groups: readonly ReleaseGroup[],
  candidates: readonly (readonly string[])[],
  versions: Readonly<Record<string, string>>,
  index = 0,
): Generator<Readonly<Record<string, string>>> {
  if (index === groups.length) {
    yield versions;
    return;
  }
  for (const version of candidates[index]!) {
    const next = { ...versions };
    for (const name of groups[index]!.packages) next[name] = version;
    yield* combinations(groups, candidates, next, index + 1);
  }
}
