/**
 * The JUCE runtime's `doctor` checks: CMake, a C++ compiler, the tools Skia is
 * built with, and a locatable JUCE checkout. Per the CLI's design, runtime-specific toolchains are diagnosed
 * here, not in the CLI's environment probes. Dependencies (the command probe,
 * the environment) are injected so the report is unit-testable with the
 * toolchain absent.
 */

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
}

/** Builds the JUCE toolchain diagnostic report. */
export async function buildDoctorReport(
  fs: FileSystemHost,
  options: Pick<JuceOptions, 'jucePath'>,
  deps: DoctorDeps = {},
): Promise<DoctorReport> {
  const probe = deps.probe ?? probeCommand;
  const env = deps.env ?? process.env;

  return {
    checks: [
      checkCMake(probe),
      checkCompiler(probe),
      checkSkiaTools(probe),
      await checkJuce(fs, options, env),
    ],
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
 * Soundor builds Skia from source on the first configure (then caches it),
 * which needs git, Python 3 and ninja.
 */
function checkSkiaTools(probe: CommandProbe): DoctorCheck {
  const missing: string[] = [];
  if (!probe('git', ['--version']).ok) missing.push('git');
  if (!['python3', 'python'].some((python) => probe(python, ['--version']).ok))
    missing.push('Python 3');
  if (!probe('ninja', ['--version']).ok) missing.push('ninja');
  if (missing.length === 0) {
    return {
      label: 'Skia build tools',
      status: 'ok',
      detail: 'git, Python 3 and ninja available.',
    };
  }
  return {
    label: 'Skia build tools',
    status: 'fail',
    detail: `Missing ${missing.join(', ')}; Soundor builds Skia (its renderer) from source once per machine.`,
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
