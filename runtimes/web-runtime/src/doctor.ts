/**
 * The Web runtime's `doctor` checks: a Node.js that Vite supports, Vite
 * itself (installed with this package), Rust's WebAssembly target (the
 * Rust processor and controller library, lib/, is compiled to it) and legacy Web host
 * migration. Dependencies are injected so the report is unit-testable.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

import type {
  DoctorCheck,
  DoctorReport,
  FileSystemHost,
} from '@soundor/runtime-sdk';
import { version as viteVersion } from 'vite';

/** The Node.js versions Vite runs on. */
const NODE_RANGES = [
  { major: 20, minor: 19 },
  { major: 22, minor: 12 },
] as const;

export interface WebDoctorDeps {
  readonly nodeVersion?: string;
  readonly viteVersion?: string;
  /** Where Rust keeps the WebAssembly target's standard library, if it has one. */
  readonly wasmTargetLibraries?: () => string[] | undefined;
}

/**
 * The files of the wasm32-unknown-unknown standard library, from rustc;
 * undefined when rustc cannot say (Rust missing).
 */
function wasmTargetLibraries(): string[] | undefined {
  const result = spawnSync(
    'rustc',
    ['--print', 'target-libdir', '--target', 'wasm32-unknown-unknown'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) return undefined;
  const dir = result.stdout.trim();
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** Rust's WebAssembly target: checked, never installed. */
export function checkWasmTarget(libraries: string[] | undefined): DoctorCheck {
  if (libraries === undefined)
    return {
      label: 'Rust WebAssembly target',
      status: 'fail',
      detail:
        "rustc was not found; it compiles the plugin's Rust library (lib/) to WebAssembly.",
      suggestion:
        'Install Rust with rustup (https://rustup.rs), then: rustup target add wasm32-unknown-unknown',
    };
  if (!libraries.some((file) => /^libstd-.*\.rlib$/.test(file)))
    return {
      label: 'Rust WebAssembly target',
      status: 'fail',
      detail:
        'wasm32-unknown-unknown is not installed: the Rust library (lib/) cannot be compiled for the browser.',
      suggestion: 'rustup target add wasm32-unknown-unknown',
    };
  return {
    label: 'Rust WebAssembly target',
    status: 'ok',
    detail: 'wasm32-unknown-unknown',
  };
}

/** Builds the Web runtime's diagnostic report. */
export async function buildWebDoctorReport(
  fs: FileSystemHost,
  runtimeId: string,
  deps: WebDoctorDeps = {},
): Promise<DoctorReport> {
  return {
    checks: [
      checkNode(deps.nodeVersion ?? process.versions.node),
      {
        label: 'Vite',
        status: 'ok',
        detail: `vite ${deps.viteVersion ?? viteVersion} (installed with @soundor/web-runtime)`,
      },
      checkWasmTarget((deps.wasmTargetLibraries ?? wasmTargetLibraries)()),
      await checkScaffold(fs, runtimeId),
    ],
  };
}

function checkNode(version: string): DoctorCheck {
  if (supportsVite(version)) {
    return { label: 'Node.js', status: 'ok', detail: `v${version}` };
  }
  return {
    label: 'Node.js',
    status: 'fail',
    detail: `v${version} is older than Vite supports (^20.19.0 or >=22.12.0).`,
    suggestion: 'Install Node.js 22.12 or newer.',
  };
}

function supportsVite(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major >= 23) return true;
  return NODE_RANGES.some(
    (range) => major === range.major && minor >= range.minor,
  );
}

async function checkScaffold(
  fs: FileSystemHost,
  runtimeId: string,
): Promise<DoctorCheck> {
  if (await fs.exists(fs.resolve('runtimes', runtimeId))) {
    return {
      label: 'Managed Web host',
      status: 'fail',
      detail: 'Legacy runtimes/web host found.',
      suggestion:
        "Move custom inputs to a browser module, set webRuntime({ inputs: './web/inputs.ts' }), then remove runtimes/web yourself. See https://soundor.dev/docs/web-runtime#migration.",
    };
  }
  return {
    label: 'Managed Web host',
    status: 'ok',
    detail: 'Provided by @soundor/web-runtime; no initialization needed.',
  };
}
