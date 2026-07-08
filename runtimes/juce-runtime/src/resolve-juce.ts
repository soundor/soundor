/**
 * Locating a JUCE checkout. The runtime never downloads JUCE — its license
 * requires explicit acceptance — so it resolves an existing copy from the two
 * mechanisms JUCE/CMake support by default: the `jucePath` option, then the
 * `JUCE_DIR` variable (CMake's `<package>_DIR` convention). It deliberately
 * invents no filesystem conventions of its own. Resolution is pure over the
 * injected {@link FileSystemHost} and environment so it is unit-testable without
 * a real JUCE.
 */

import type { FileSystemHost } from '@soundor/runtime-sdk';

import type { ResolvedJuceOptions } from './options';

export type JuceSource = 'option' | 'env';

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
  options: ResolvedJuceOptions,
  env: NodeJS.ProcessEnv,
): { path: string; source: JuceSource }[] {
  const out: { path: string; source: JuceSource }[] = [];
  if (options.jucePath) {
    out.push({ path: fs.resolve(options.jucePath), source: 'option' });
  }
  const envDir = env['JUCE_DIR'];
  if (envDir) out.push({ path: fs.resolve(envDir), source: 'env' });
  return out;
}

/** Resolves a JUCE checkout without ever fetching one. */
export async function resolveJuce(
  fs: FileSystemHost,
  options: ResolvedJuceOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<JuceResolution> {
  const probed = candidates(fs, options, env);
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
