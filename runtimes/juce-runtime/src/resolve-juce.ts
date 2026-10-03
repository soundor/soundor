/**
 * Locating a JUCE checkout. The runtime never downloads JUCE — its license
 * requires explicit acceptance — so it resolves an existing copy from explicit
 * config first, then a conservative set of conventional install paths.
 * Resolution is pure over the injected {@link FileSystemHost}, environment, and
 * host metadata so it is unit-testable without a real JUCE.
 */

import { homedir } from 'node:os';

import type { FileSystemHost } from '@soundor/runtime-sdk';

import type { JuceOptions } from './options';

export type JuceSource = 'option' | 'env' | 'well-known';

export interface JuceResolveSystem {
  readonly platform: NodeJS.Platform;
  readonly homeDir?: string;
}

export interface JuceResolution {
  /** Whether a valid JUCE checkout was found. */
  readonly found: boolean;
  /** Absolute path to the JUCE checkout, when found. */
  readonly path?: string;
  /** Which input supplied the found path. */
  readonly source?: JuceSource;
  /** Every candidate considered, in probe order (for diagnostics). */
  readonly searched: readonly string[];
}

/**
 * A directory is treated as a JUCE checkout when it carries JUCE's top-level
 * `CMakeLists.txt` and `modules/` directory — the markers `add_subdirectory`
 * needs.
 */
async function isJuceCheckout(
  fs: FileSystemHost,
  path: string,
): Promise<boolean> {
  const [hasCMake, hasModules] = await Promise.all([
    fs.exists(fs.resolve(path, 'CMakeLists.txt')),
    fs.exists(fs.resolve(path, 'modules')),
  ]);
  return hasCMake && hasModules;
}

/** Ordered candidate paths, paired with the source that contributed them. */
function candidates(
  fs: FileSystemHost,
  options: Pick<JuceOptions, 'jucePath'>,
  env: NodeJS.ProcessEnv,
  system: JuceResolveSystem,
): { path: string; source: JuceSource }[] {
  const out: { path: string; source: JuceSource }[] = [];
  const add = (path: string, source: JuceSource): void => {
    const resolved = fs.resolve(path);
    if (!out.some((candidate) => candidate.path === resolved)) {
      out.push({ path: resolved, source });
    }
  };
  if (options.jucePath) {
    add(options.jucePath, 'option');
  }
  const envDir = env['JUCE_DIR'];
  if (envDir) add(envDir, 'env');
  for (const path of wellKnownPaths(system)) {
    add(path, 'well-known');
  }
  return out;
}

function wellKnownPaths(system: JuceResolveSystem): string[] {
  const out = ['./JUCE'];
  if (system.homeDir) {
    out.push(`${system.homeDir}/JUCE`, `${system.homeDir}/SDKs/JUCE`);
  }
  switch (system.platform) {
    case 'darwin':
      out.push('/Applications/JUCE', '/opt/JUCE');
      break;
    case 'linux':
      out.push('/opt/JUCE');
      break;
    case 'win32':
      out.push('C:\\JUCE', 'C:\\SDKs\\JUCE');
      break;
  }
  return [...new Set(out)];
}

function defaultSystem(): JuceResolveSystem {
  return { platform: process.platform, homeDir: homedir() };
}

/** Resolves a JUCE checkout without ever fetching one. */
export async function resolveJuce(
  fs: FileSystemHost,
  options: Pick<JuceOptions, 'jucePath'>,
  env: NodeJS.ProcessEnv = process.env,
  system: JuceResolveSystem = defaultSystem(),
): Promise<JuceResolution> {
  const probed = candidates(fs, options, env, system);
  const searched = probed.map((candidate) => candidate.path);
  for (const candidate of probed) {
    if (await isJuceCheckout(fs, candidate.path)) {
      return {
        found: true,
        path: candidate.path,
        source: candidate.source,
        searched,
      };
    }
  }
  return { found: false, searched };
}
