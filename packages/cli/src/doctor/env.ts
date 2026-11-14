/**
 * Environment probes for `soundor doctor`. These run standalone (no project
 * required) and answer "does this machine have the baseline toolchain the CLI
 * needs?" — Node, a package manager and Rust. Runtime-specific toolchains
 * (e.g. CMake/JUCE) are diagnosed by each runtime's own `doctor` hook, not here.
 */

import type { DoctorCheck } from '@soundor/config';
import { probeCommand, type CommandProbe } from '@soundor/core';

/** Lowest Node major the CLI supports (mirrors `package.json` engines `>=22`). */
export const REQUIRED_NODE_MAJOR = 22;

/**
 * The package managers Soundor supports, in the order we probe for one. Yarn
 * (Plug'n'Play has no node_modules for the native build to find packages
 * in) and bun are not supported.
 */
const PACKAGE_MANAGERS = ['pnpm', 'npm'] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/**
 * The oldest Rust the SDK compiles with (its Cargo.toml's `rust-version`).
 * A project's rust-toolchain.toml asks for stable, newer than this.
 */
export const REQUIRED_RUST = [1, 87] as const;

/** Runs the CLI-owned environment checks. Pure/synchronous, no side effects. */
export function runEnvironmentChecks(
  probe: CommandProbe = probeCommand,
): DoctorCheck[] {
  return [checkNodeVersion(), checkPackageManager(), checkRust(probe)];
}

/**
 * Rust, which compiles every plugin's audio processing (`native/`): Cargo
 * and a rustc at least {@link REQUIRED_RUST}. Never installs anything.
 */
export function checkRust(probe: CommandProbe = probeCommand): DoctorCheck {
  const required = REQUIRED_RUST.join('.');
  const cargo = probe('cargo', ['--version']);
  const rustc = probe('rustc', ['--version']);
  if (!cargo.ok || !rustc.ok)
    return {
      label: 'Rust',
      status: 'fail',
      detail: `${cargo.ok ? 'rustc' : 'Cargo'} was not found; it compiles the plugin's audio processing (native/).`,
      suggestion: `Install Rust ${required} or newer with rustup (https://rustup.rs).`,
    };
  const match = /rustc (\d+)\.(\d+)\.(\d+)/.exec(rustc.version ?? '');
  if (match === null)
    return {
      label: 'Rust',
      status: 'warn',
      detail: `Could not read the version of rustc ('${rustc.version ?? ''}').`,
      suggestion: `Make sure rustc ${required} or newer is on PATH.`,
    };
  const [major, minor] = [Number(match[1]), Number(match[2])];
  if (
    major < REQUIRED_RUST[0] ||
    (major === REQUIRED_RUST[0] && minor < REQUIRED_RUST[1])
  )
    return {
      label: 'Rust',
      status: 'fail',
      detail: `rustc ${match[0].slice(6)} is older than ${required}.`,
      suggestion: 'Update it: rustup update stable.',
    };
  return {
    label: 'Rust',
    status: 'ok',
    detail: `${rustc.version}; ${cargo.version}.`,
  };
}

function checkNodeVersion(): DoctorCheck {
  const version = process.versions.node;
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  if (Number.isNaN(major)) {
    return {
      label: 'Node.js',
      status: 'warn',
      detail: `Could not parse Node version '${version}'.`,
      suggestion: `Ensure Node >= ${REQUIRED_NODE_MAJOR} is installed.`,
    };
  }
  if (major < REQUIRED_NODE_MAJOR) {
    return {
      label: 'Node.js',
      status: 'fail',
      detail: `Node ${version} is below the required >= ${REQUIRED_NODE_MAJOR}.`,
      suggestion: `Upgrade Node to >= ${REQUIRED_NODE_MAJOR} (e.g. via nvm or your OS package manager).`,
    };
  }
  return {
    label: 'Node.js',
    status: 'ok',
    detail: `Node ${version} (>= ${REQUIRED_NODE_MAJOR}).`,
  };
}

function checkPackageManager(): DoctorCheck {
  const running = runningPackageManager();
  const order =
    running !== undefined && isSupported(running)
      ? [running, ...PACKAGE_MANAGERS.filter((pm) => pm !== running)]
      : [...PACKAGE_MANAGERS];

  for (const pm of order) {
    const probe = probeCommand(pm, ['--version']);
    if (!probe.ok) continue;
    const found = probe.version ? `${pm} ${probe.version}` : `${pm}`;
    if (running !== undefined && !isSupported(running)) {
      return {
        label: 'Package manager',
        status: 'warn',
        detail: `Running under ${running}, which Soundor does not support; ${found} is available.`,
        suggestion: `Use ${PACKAGE_MANAGERS.join(' or ')} for Soundor projects.`,
      };
    }
    return {
      label: 'Package manager',
      status: 'ok',
      detail: `${found}.`,
    };
  }

  return {
    label: 'Package manager',
    status: 'fail',
    detail: `No supported package manager found (looked for ${PACKAGE_MANAGERS.join(', ')}).`,
    suggestion:
      'Install pnpm (https://pnpm.io/installation), or use the npm that comes with Node.',
  };
}

/** The package manager running this command, by name, if any. */
function runningPackageManager(): string | undefined {
  const agent = process.env['npm_config_user_agent'];
  if (!agent) return undefined;
  return agent.split('/')[0] || undefined;
}

function isSupported(name: string): name is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(name);
}
