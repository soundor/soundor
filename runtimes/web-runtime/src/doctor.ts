/**
 * The Web runtime's `doctor` checks. A browser host needs no native
 * toolchain: only a Node.js that Vite supports, Vite itself (installed with
 * this package) and the scaffolded Web host project. Dependencies are
 * injected so the report is unit-testable.
 */

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
  const dir = `runtimes/${runtimeId}`;
  const missing: string[] = [];
  for (const file of ['index.html', 'src/main.ts']) {
    if (!(await fs.exists(fs.resolve(dir, file)))) missing.push(file);
  }
  if (missing.length === 0) {
    return { label: 'Web host project', status: 'ok', detail: dir };
  }
  return {
    label: 'Web host project',
    status: 'warn',
    detail: `${dir} is missing ${missing.join(', ')}.`,
    suggestion: `Run \`soundor init ${runtimeId}\` to scaffold it (existing files are kept).`,
  };
}
