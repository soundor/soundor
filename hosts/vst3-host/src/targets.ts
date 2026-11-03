import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import table from '../targets.json' with { type: 'json' };

export interface Target {
  target: string;
  package: string;
  os: string[];
  cpu: string[];
  libc?: string[];
  runner: string;
  architectures: string[];
  /** Relative to the platform package's root. */
  executable: string;
}

/** The platform packages a release generates (targets.json). */
export const targets: readonly Target[] = table.targets;

/** This package's root: the directory of its package.json. */
export const packageRoot: string = fileURLToPath(
  new URL('..', import.meta.url),
);

export interface PackageManifest {
  name: string;
  version: string;
  optionalDependencies?: Record<string, string>;
}

export function ownManifest(root = packageRoot): PackageManifest {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
}

/** A checkout of the repository, not an installed package: the published
    manifest always pins its platform packages. */
export function isSourceWorkspace(root = packageRoot): boolean {
  return (
    ownManifest(root).optionalDependencies === undefined &&
    existsSync(join(root, 'native/src'))
  );
}

export interface Platform {
  platform: NodeJS.Platform;
  arch: string;
  /** Linux: "glibc" or "musl". */
  libc?: string;
  /** Linux with glibc: its version, such as "2.39". */
  glibc?: string;
}

export function currentPlatform(): Platform {
  if (process.platform !== 'linux')
    return { platform: process.platform, arch: process.arch };
  const header = (
    process.report.getReport() as { header?: { glibcVersionRuntime?: string } }
  ).header;
  return header?.glibcVersionRuntime
    ? {
        platform: 'linux',
        arch: process.arch,
        libc: 'glibc',
        glibc: header.glibcVersionRuntime,
      }
    : { platform: 'linux', arch: process.arch, libc: 'musl' };
}

/** The target whose executable runs here, if any. */
export function targetFor(
  platform: Platform = currentPlatform(),
): Target | undefined {
  return targets.find(
    (target) =>
      target.os.includes(platform.platform) &&
      target.cpu.includes(platform.arch) &&
      (target.libc === undefined || target.libc.includes(platform.libc ?? '')),
  );
}

export function describePlatform(
  platform: Platform = currentPlatform(),
): string {
  return `${platform.platform}-${platform.arch}${platform.libc ? `-${platform.libc}` : ''}`;
}

/** Version comparison of dotted numbers ("2.35" < "2.39"). */
export function versionAtLeast(actual: string, required: string): boolean {
  const a = actual.split('.').map(Number);
  const b = required.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
