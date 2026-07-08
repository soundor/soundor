/**
 * The JUCE runtime's `doctor` checks: CMake, a C++ compiler, and a locatable
 * JUCE checkout. Per the CLI's design, runtime-specific toolchains are diagnosed
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

import type { ResolvedJuceOptions } from './options';
import { resolveJuce } from './resolve-juce';

/** Minimum CMake JUCE's CMake API requires. */
const MIN_CMAKE = '3.22';

/** C++ compiler front-ends probed, in order. */
const COMPILERS = ['c++', 'clang++', 'g++', 'cc'] as const;

export interface DoctorDeps {
  readonly probe?: CommandProbe;
  readonly env?: NodeJS.ProcessEnv;
}

/** Builds the JUCE toolchain diagnostic report. */
export async function buildDoctorReport(
  fs: FileSystemHost,
  options: ResolvedJuceOptions,
  deps: DoctorDeps = {},
): Promise<DoctorReport> {
  const probe = deps.probe ?? probeCommand;
  const env = deps.env ?? process.env;

  return {
    checks: [
      checkCMake(probe),
      checkCompiler(probe),
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

function checkCompiler(probe: CommandProbe): DoctorCheck {
  for (const compiler of COMPILERS) {
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
    detail: `No C++ compiler found (looked for ${COMPILERS.join(', ')}).`,
    suggestion:
      'Install a C++ toolchain (Xcode Command Line Tools, MSVC Build Tools, or GCC/Clang).',
  };
}

async function checkJuce(
  fs: FileSystemHost,
  options: ResolvedJuceOptions,
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
