// A release archive in the Soundor cache, laid out as CMake's prebuilt mode
// lays it out (SoundorEngineResolve.cmake), so that both share it:
//
//   <cache>/engine-prebuilts/<sha256>.tar.gz   the archive, as downloaded
//   <cache>/engine-prebuilts/<sha256>/         its extraction, complete once
//                                               it holds .soundor-verified
//
// An archive is kept only once its SHA-256 matched the manifest; an
// extraction appears whole (extracted aside, then renamed into place). What
// a cached copy says is checked again on every use.

import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { removeDirectory, withLock, writeAtomically } from './cache.ts';
import { EngineError } from './errors.ts';
import type { Fetch, Manifest, ManifestArtifact } from './manifest.ts';
import { readArchive } from './tar.ts';

const VERIFIED = '.soundor-verified';

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(path: string): string {
  return sha256(readFileSync(path));
}

/** The archive's top directory: its file name without `.tar.gz`. */
export function archiveTop(artifact: ManifestArtifact): string {
  return artifact.file.replace(/\.tar\.gz$/, '');
}

async function download(
  artifact: ManifestArtifact,
  fetcher: Fetch,
): Promise<Buffer> {
  const url = new URL(artifact.url);
  let bytes: Buffer;
  try {
    if (url.protocol === 'file:') bytes = await readFile(fileURLToPath(url));
    else if (url.protocol === 'https:') {
      const response = await fetcher(url.href, {
        signal: AbortSignal.timeout(15 * 60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    } else throw new Error(`${url.protocol} URLs are not downloaded`);
  } catch (error) {
    throw new EngineError(
      'download',
      `Downloading ${artifact.file} failed (${(error as Error).message}): ${artifact.url}`,
      { cause: error },
    );
  }
  if (bytes.length !== artifact.size || sha256(bytes) !== artifact.sha256)
    throw new EngineError(
      'download',
      `${artifact.url} is not the archive the manifest names: ${bytes.length} bytes, SHA-256 ${sha256(bytes)}; expected ${artifact.size} bytes, ${artifact.sha256}`,
    );
  return bytes;
}

/** The extraction's directory, or undefined while it is not complete. */
function verifiedDirectory(extracted: string, top: string): string | undefined {
  try {
    const marker = readFileSync(join(extracted, VERIFIED), 'utf8').trim();
    if (marker === extracted.slice(-64)) return join(extracted, top);
  } catch {
    // Not there, or not complete.
  }
  return undefined;
}

/**
 * Where <artifact> is extracted in the cache: downloaded (once) and verified
 * when it is not there yet. Concurrent callers wait for each other.
 */
export async function installArchive(
  artifact: ManifestArtifact,
  context: { cache: string; fetch: Fetch; log: (message: string) => void },
): Promise<string> {
  const directory = join(context.cache, 'engine-prebuilts');
  const extracted = join(directory, artifact.sha256);
  const top = archiveTop(artifact);
  const ready = verifiedDirectory(extracted, top);
  if (ready) return ready;
  return withLock(
    `${extracted}.node-lock`,
    async () => {
      const done = verifiedDirectory(extracted, top);
      if (done) return done;
      const archive = `${extracted}.tar.gz`;
      let bytes: Buffer | undefined;
      if (existsSync(archive)) {
        const cached = readFileSync(archive);
        // Only the archive the manifest names; anything else is fetched again.
        if (sha256(cached) === artifact.sha256) bytes = cached;
      }
      if (bytes === undefined) {
        context.log(`downloading ${artifact.file} (${artifact.size} bytes)`);
        bytes = await download(artifact, context.fetch);
        writeAtomically(archive, bytes);
      }
      let entries;
      try {
        entries = readArchive(bytes, top);
      } catch (error) {
        throw new EngineError(
          'artifact',
          `${artifact.file} is not a valid prebuilt archive: ${(error as Error).message}`,
          { cause: error },
        );
      }
      const partial = `${extracted}.${randomUUID()}.partial`;
      try {
        for (const entry of entries) {
          const path = join(partial, top, ...entry.path.split('/'));
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, entry.data);
          if (entry.executable && process.platform !== 'win32')
            chmodSync(path, 0o755);
        }
        writeFileSync(join(partial, VERIFIED), `${artifact.sha256}\n`);
        await publish(partial, extracted, top);
      } finally {
        removeDirectory(partial);
      }
      return join(extracted, top);
    },
    {
      waiting: () =>
        context.log(`waiting for another process to prepare ${artifact.file}`),
    },
  );
}

/**
 * Renames a complete extraction into place. CMake's prebuilt mode extracts
 * into the same place (under its own lock) and marks it verified after its
 * rename: an unmarked one is given that long to finish, then replaced.
 */
async function publish(
  partial: string,
  extracted: string,
  top: string,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(partial, extracted);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'ENOTEMPTY' && code !== 'EPERM')
        throw error;
    }
    if (verifiedDirectory(extracted, top)) return;
    if (attempt >= 50) removeDirectory(extracted);
    else await sleep(100);
  }
}

/** soundor-engine.json, which every staged and archived engine carries. */
export interface EngineMetadata {
  format: 1;
  engine: {
    version: string;
    abiNamespace: string;
    sourceCommit: string | null;
    sourceFingerprint: string;
  };
  variant: string;
  configuration: string;
  target: { name: string; os: string; architectures: string[] };
  toolchain: { compiler: string; compilerVersion: string };
  /** The web module's protocol. */
  protocol?: number;
  /** The web module: its path in the archive, SHA-256 and size. */
  files?: { wasm?: { path: string; sha256: string; size: number } };
  link?: Record<string, string[]>;
  hermes?: { compiler: string };
}

export function readMetadata(directory: string): EngineMetadata {
  const path = join(directory, 'soundor-engine.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as EngineMetadata;
  } catch (error) {
    throw new EngineError(
      'artifact',
      `${path} is missing or not JSON: ${(error as Error).message}`,
      { cause: error },
    );
  }
}

/**
 * Checks an extracted archive against its manifest entry: the engine, the
 * commit and inputs it was built from, its target, and (web) its protocol
 * and module. Returns the problems; none means it is the one named.
 */
export function metadataProblems(
  metadata: EngineMetadata,
  manifest: Manifest,
  artifact: ManifestArtifact,
  directory: string,
): string[] {
  const problems: string[] = [];
  const expect = (what: string, actual: unknown, wanted: unknown) => {
    if (actual !== wanted)
      problems.push(
        `${what} is ${JSON.stringify(actual)}, not ${JSON.stringify(wanted)}`,
      );
  };
  expect('format', metadata.format, 1);
  expect('engine.version', metadata.engine?.version, manifest.engineVersion);
  expect(
    'engine.abiNamespace',
    metadata.engine?.abiNamespace,
    manifest.abiNamespace,
  );
  expect(
    'engine.sourceCommit',
    metadata.engine?.sourceCommit,
    manifest.sourceCommit,
  );
  expect(
    'engine.sourceFingerprint',
    metadata.engine?.sourceFingerprint,
    artifact.target === 'web'
      ? artifact.sourceFingerprint
      : manifest.sourceFingerprint,
  );
  expect('target.name', metadata.target?.name, artifact.target);
  expect('variant', metadata.variant, artifact.variant);
  if (artifact.target === 'web') {
    expect('protocol', metadata.protocol, artifact.protocol);
    const wasm = metadata.files?.wasm;
    if (!wasm) problems.push('files.wasm is missing');
    else {
      const path = join(directory, wasm.path);
      if (!existsSync(path)) problems.push(`${wasm.path} is missing`);
      else if (sha256File(path) !== wasm.sha256)
        problems.push(`${wasm.path} does not match its SHA-256`);
    }
  }
  return problems;
}
