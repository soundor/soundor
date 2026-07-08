/**
 * Environment probes for `soundor doctor`. These run standalone (no project
 * required) and answer "does this machine have the baseline toolchain the CLI
 * needs?" — currently Node and a package manager. Runtime-specific toolchains
 * (e.g. CMake/JUCE) are diagnosed by each runtime's own `doctor` hook, not here.
 */

import type { DoctorCheck } from '@soundor/config';
import { probeCommand } from '@soundor/core';

/** Lowest Node major the CLI supports (mirrors `package.json` engines `>=22`). */
export const REQUIRED_NODE_MAJOR = 22;

/** Package managers we recognize, in the order we probe for one. */
const KNOWN_PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const;

/** Runs the CLI-owned environment checks. Pure/synchronous, no side effects. */
export function runEnvironmentChecks(): DoctorCheck[] {
  return [checkNodeVersion(), checkPackageManager()];
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
  const preferred = detectPackageManager();
  const order = preferred
    ? [preferred, ...KNOWN_PACKAGE_MANAGERS.filter((pm) => pm !== preferred)]
    : [...KNOWN_PACKAGE_MANAGERS];

  for (const pm of order) {
    const probe = probeCommand(pm, ['--version']);
    if (probe.ok) {
      return {
        label: 'Package manager',
        status: 'ok',
        detail: probe.version ? `${pm} ${probe.version}.` : `${pm} available.`,
      };
    }
  }

  return {
    label: 'Package manager',
    status: 'fail',
    detail: `No supported package manager found (looked for ${KNOWN_PACKAGE_MANAGERS.join(', ')}).`,
    suggestion:
      'Install a package manager such as pnpm (https://pnpm.io/installation).',
  };
}

/** Best-effort detection of the active package manager from the environment. */
function detectPackageManager():
  | (typeof KNOWN_PACKAGE_MANAGERS)[number]
  | undefined {
  const agent = process.env['npm_config_user_agent'];
  if (!agent) return undefined;
  const name = agent.split('/')[0];
  return KNOWN_PACKAGE_MANAGERS.find((pm) => pm === name);
}
