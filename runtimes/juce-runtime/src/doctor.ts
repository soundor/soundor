/**
 * The JUCE runtime's `doctor` checks: CMake, a C++ compiler, the tools Skia and
 * ANGLE are built with, a locatable JUCE checkout, and the engine (its
 * prebuilt release for this platform, in prebuilt mode). Per the CLI's design, runtime-specific toolchains are diagnosed
 * here, not in the CLI's environment probes. Dependencies (the command probe,
 * the environment) are injected so the report is unit-testable with the
 * toolchain absent.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import {
  probeCommand,
  type CommandProbe,
  type DoctorCheck,
  type DoctorReport,
  type FileSystemHost,
} from '@soundor/runtime-sdk';

import type { JuceOptions } from './options';
import { resolveJuce } from './resolve-juce';

/** Minimum CMake JUCE's CMake API requires. */
const MIN_CMAKE = '3.22';

/** C++ compiler front-ends probed, in order. */
const CXX_COMPILERS = ['c++', 'clang++', 'g++'] as const;

export interface DoctorDeps {
  readonly probe?: CommandProbe;
  readonly env?: NodeJS.ProcessEnv;
  /** The installed engine; default: `@soundor/engine` as this package resolves it. */
  readonly engine?: InstalledEngine;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
}

/** What the installed `@soundor/engine` is, and the prebuilt release it names. */
export interface InstalledEngine {
  readonly version: string;
  /** artifacts/manifest.json: only a published package has one. */
  readonly manifest?: {
    readonly tag: string;
    readonly artifacts: readonly {
      readonly target: string;
      readonly variant: string;
    }[];
  };
}

export function installedEngine(): InstalledEngine {
  const dir = dirname(
    createRequire(import.meta.url).resolve('@soundor/engine/package.json'),
  );
  const manifest = join(dir, 'artifacts', 'manifest.json');
  return {
    version: (
      JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        version: string;
      }
    ).version,
    manifest: existsSync(manifest)
      ? (JSON.parse(
          readFileSync(manifest, 'utf8'),
        ) as InstalledEngine['manifest'])
      : undefined,
  };
}

/** Builds the JUCE toolchain diagnostic report. */
export async function buildDoctorReport(
  fs: FileSystemHost,
  options: Pick<JuceOptions, 'jucePath' | 'engine'>,
  deps: DoctorDeps = {},
): Promise<DoctorReport> {
  const probe = deps.probe ?? probeCommand;
  const env = deps.env ?? process.env;

  return {
    checks: [
      checkCMake(probe),
      checkCompiler(probe),
      checkNativeBuildTools(probe),
      await checkJuce(fs, options, env),
      checkEngine(
        options.engine?.mode ?? 'prebuilt',
        deps.engine ?? installedEngine(),
        prebuiltTarget(
          deps.platform ?? process.platform,
          deps.arch ?? process.arch,
        ),
      ),
    ],
  };
}

/** The prebuilt target a plugin built on this machine needs, if there is one. */
export function prebuiltTarget(
  platform: NodeJS.Platform,
  arch: string,
): string | undefined {
  if (platform === 'darwin') return 'macos-universal';
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'win32' && arch === 'x64') return 'windows-x64';
  return undefined;
}

function checkEngine(
  mode: 'prebuilt' | 'source',
  engine: InstalledEngine,
  target: string | undefined,
): DoctorCheck {
  const label = 'Soundor Engine';
  const useSource =
    "Build the engine from source: juceRuntime({ engine: { mode: 'source' } }).";
  if (mode === 'source')
    return {
      label,
      status: 'ok',
      detail: `Source mode: @soundor/engine ${engine.version} is compiled with the plugin (Skia, ANGLE and Hermes once per machine).`,
    };
  if (engine.manifest === undefined)
    return {
      label,
      status: 'fail',
      detail: `@soundor/engine ${engine.version} names no prebuilt release (a workspace or unpublished package).`,
      suggestion: useSource,
    };
  const variants = engine.manifest.artifacts
    .filter((artifact) => artifact.target === target)
    .map((artifact) => artifact.variant);
  if (
    target === undefined ||
    !variants.includes('debug') ||
    !variants.includes('release')
  )
    return {
      label,
      status: 'fail',
      detail: `${engine.manifest.tag} has no engine for ${target ?? 'this platform'}.`,
      suggestion: useSource,
    };
  return {
    label,
    status: 'ok',
    detail: `Prebuilt: ${engine.manifest.tag} (${target}, debug and release; downloaded and verified on the first build).`,
  };
}

function checkCMake(probe: CommandProbe): DoctorCheck {
  const result = probe('cmake', ['--version']);
  if (!result.ok) {
    return {
      label: 'CMake',
      status: 'fail',
      detail: result.error ?? 'cmake not found.',
      suggestion: `Install CMake >= ${MIN_CMAKE} (https://cmake.org/download/).`,
    };
  }
  return {
    label: 'CMake',
    status: 'ok',
    detail: firstLine(result.version) ?? 'cmake available.',
  };
}

export function findCMake(
  probe: CommandProbe = probeCommand,
): string | undefined {
  return probe('cmake', ['--version']).ok ? 'cmake' : undefined;
}

export function findCppCompiler(
  probe: CommandProbe = probeCommand,
): string | undefined {
  for (const compiler of CXX_COMPILERS) {
    if (probe(compiler, ['--version']).ok) return compiler;
  }
  return undefined;
}

function checkCompiler(probe: CommandProbe): DoctorCheck {
  for (const compiler of CXX_COMPILERS) {
    const result = probe(compiler, ['--version']);
    if (result.ok) {
      return {
        label: 'C++ compiler',
        status: 'ok',
        detail: `${compiler}: ${firstLine(result.version) ?? 'available'}.`,
      };
    }
  }
  return {
    label: 'C++ compiler',
    status: 'fail',
    detail: `No C++ compiler found (looked for ${CXX_COMPILERS.join(', ')}).`,
    suggestion:
      'Install a C++ toolchain (Xcode Command Line Tools, MSVC Build Tools, or GCC/Clang).',
  };
}

/**
 * Soundor builds Skia and ANGLE from source on the first configure (then
 * caches them), which needs git, Python 3 and ninja.
 */
function checkNativeBuildTools(probe: CommandProbe): DoctorCheck {
  const missing: string[] = [];
  if (!probe('git', ['--version']).ok) missing.push('git');
  if (!['python3', 'python'].some((python) => probe(python, ['--version']).ok))
    missing.push('Python 3');
  if (!probe('ninja', ['--version']).ok) missing.push('ninja');
  if (missing.length === 0) {
    return {
      label: 'Skia and ANGLE build tools',
      status: 'ok',
      detail: 'git, Python 3 and ninja available.',
    };
  }
  return {
    label: 'Skia and ANGLE build tools',
    status: 'fail',
    detail: `Missing ${missing.join(', ')}; Soundor builds Skia and ANGLE (its renderers) from source once per machine.`,
    suggestion: `Install ${missing.join(', ')} and make ${missing.length === 1 ? 'it' : 'them'} available on PATH.`,
  };
}

async function checkJuce(
  fs: FileSystemHost,
  options: Pick<JuceOptions, 'jucePath'>,
  env: NodeJS.ProcessEnv,
): Promise<DoctorCheck> {
  const resolution = await resolveJuce(fs, options, env);
  if (resolution.found) {
    return {
      label: 'JUCE',
      status: 'ok',
      detail: `Found JUCE at ${resolution.path} (via ${resolution.source}).`,
    };
  }
  return {
    label: 'JUCE',
    status: 'fail',
    detail: `JUCE not found. Searched: ${resolution.searched.join(', ')}.`,
    suggestion:
      'JUCE is not downloaded automatically (its license requires acceptance). ' +
      'Set jucePath in juceRuntime({ jucePath }), set JUCE_DIR, or install JUCE in a well-known location.',
  };
}

function firstLine(value: string | undefined): string | undefined {
  return value?.split('\n')[0]?.trim() || undefined;
}
