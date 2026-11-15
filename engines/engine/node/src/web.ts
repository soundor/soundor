// The WebAssembly core: checking a module, and building one from a source
// checkout with the engine's `wasm` CMake preset (Emscripten, pinned by
// wasm/emscripten.json). A build is staged as a release archive's contents
// are, in build/wasm/stage/ — distinct from the cache, which holds only
// downloaded releases.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { webInputs } from '../../scripts/engine-inputs.mjs';
import { PROTOCOL_VERSION } from '../../web/src/protocol.ts';
import { removeDirectory, withLock } from './cache.ts';
import { EngineError } from './errors.ts';
import { type EngineMetadata, readMetadata, sha256 } from './prebuilt.ts';
import { WEB_VARIANT } from './targets.ts';

export { PROTOCOL_VERSION };

/** The module's file name, in archives and stages. */
export const WASM_FILE = 'soundor-core.wasm';

/** What a valid module file is. */
export interface CheckedModule {
  readonly sha256: string;
  readonly size: number;
  readonly protocol: number;
}

/**
 * Checks that <path> is the engine's module, speaking this package's
 * protocol: compiled, instantiated with inert imports, and asked
 * (soundor_engine_protocol takes nothing and runs no other code).
 */
export function checkModule(path: string, what: string): CheckedModule {
  let bytes: Buffer;
  try {
    if (!statSync(path).isFile()) throw new Error('it is not a file');
    bytes = readFileSync(path);
  } catch (error) {
    throw new EngineError(
      'artifact',
      `${what} (${path}) cannot be read: ${(error as Error).message}`,
      { cause: error },
    );
  }
  let protocol: unknown;
  try {
    const module = new WebAssembly.Module(new Uint8Array(bytes));
    const imports: Record<string, Record<string, () => never>> = {};
    for (const {
      module: name,
      name: field,
      kind,
    } of WebAssembly.Module.imports(module)) {
      if (kind !== 'function') throw new Error(`it imports a ${kind}`);
      (imports[name] ??= {})[field] = () => {
        throw new Error('not callable while checking');
      };
    }
    const instance = new WebAssembly.Instance(module, imports);
    const report = instance.exports['soundor_engine_protocol'];
    if (
      typeof report !== 'function' ||
      typeof instance.exports['soundor_engine_create'] !== 'function'
    )
      throw new Error(
        'it is not the Soundor engine (or predates its protocol export)',
      );
    protocol = (report as () => unknown)();
  } catch (error) {
    throw new EngineError(
      'artifact',
      `${what} (${path}) is not the Soundor engine's WebAssembly: ${(error as Error).message}`,
      { cause: error },
    );
  }
  if (protocol !== PROTOCOL_VERSION)
    throw new EngineError(
      'artifact',
      `${what} (${path}) speaks protocol ${String(protocol)}; this @soundor/engine speaks ${PROTOCOL_VERSION}: use the module of the same engine version`,
    );
  return { sha256: sha256(bytes), size: bytes.length, protocol };
}

/** The engine's ABI namespace (cmake/SoundorAbi.cmake): 0.2.1 -> v0_2_1. */
export function abiNamespace(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);
  if (!match) throw new Error(`Invalid engine package version: ${version}`);
  const suffix = match[4] ? `_p${Buffer.from(match[4]).toString('hex')}` : '';
  return `v${match[1]}_${match[2]}_${match[3]}${suffix}`;
}

export function stageDirectory(root: string): string {
  return join(root, 'build', 'wasm', 'stage');
}

/**
 * The local build in build/wasm/stage, if it was built from exactly these
 * inputs and is intact.
 */
export function localBuild(
  root: string,
  fingerprint: string,
): { wasm: string } | undefined {
  const stage = stageDirectory(root);
  if (!existsSync(join(stage, 'soundor-engine.json'))) return undefined;
  let metadata: EngineMetadata;
  try {
    metadata = readMetadata(stage);
  } catch {
    return undefined;
  }
  const wasm = metadata.files?.wasm;
  if (metadata.engine?.sourceFingerprint !== fingerprint || !wasm)
    return undefined;
  const path = join(stage, wasm.path);
  try {
    if (checkModule(path, 'The local build').sha256 !== wasm.sha256)
      return undefined;
  } catch {
    return undefined;
  }
  return { wasm: path };
}

function emscriptenToolchain(root: string, env: NodeJS.ProcessEnv): string {
  const emsdk = env['EMSDK'];
  const toolchain =
    emsdk &&
    join(emsdk, 'upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake');
  if (!toolchain || !existsSync(toolchain)) {
    const pin = JSON.parse(
      readFileSync(join(root, 'wasm', 'emscripten.json'), 'utf8'),
    ) as {
      version: string;
    };
    throw new EngineError(
      'build',
      `Building the engine's WebAssembly from source needs Emscripten ${pin.version}: install the emsdk ` +
        '(https://emscripten.org/docs/getting_started/downloads.html), ' +
        `\`emsdk install ${pin.version} && emsdk activate ${pin.version}\`, then \`source <emsdk>/emsdk_env.sh\` so that EMSDK is set.`,
    );
  }
  return toolchain;
}

/**
 * Builds the module (incrementally: `cmake --workflow --preset wasm`, into
 * build/wasm) and stages it with its metadata and license notices as a
 * release archive holds them. CI packs this stage
 * (`engine-prebuilts.mjs pack`) with SOUNDOR_ENGINE_SOURCE_COMMIT set; a
 * local build records no commit. One build at a time per checkout.
 */
export async function buildFromSource(
  root: string,
  context: { env: NodeJS.ProcessEnv; log: (message: string) => void },
): Promise<{ wasm: string; fingerprint: string }> {
  emscriptenToolchain(root, context.env);
  return withLock(
    join(root, 'build', 'wasm.lock'),
    () => {
      // The inputs as the build starts: a change meanwhile is a later build's.
      const { fingerprint } = webInputs(root);
      // Flags meant for the native linker (LDFLAGS=-fuse-ld=lld) are not
      // Emscripten's.
      const env = { ...context.env };
      delete env['LDFLAGS'];
      context.log(
        'building the WebAssembly core (cmake --workflow --preset wasm)',
      );
      const result = spawnSync('cmake', ['--workflow', '--preset', 'wasm'], {
        cwd: root,
        env,
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      if (result.error)
        throw new EngineError(
          'build',
          `Could not run cmake: ${result.error.message} (building the WebAssembly core needs CMake and Emscripten)`,
          { cause: result.error },
        );
      if (result.status !== 0)
        throw new EngineError(
          'build',
          `cmake --workflow --preset wasm failed (exit ${result.status ?? result.signal})`,
        );
      const built = join(root, 'build', 'wasm', 'web', WASM_FILE);
      const checked = checkModule(built, 'The module just built');
      const commit = context.env['SOUNDOR_ENGINE_SOURCE_COMMIT'] || null;
      if (commit !== null && !/^[0-9a-f]{40}$/.test(commit))
        throw new EngineError(
          'build',
          `SOUNDOR_ENGINE_SOURCE_COMMIT must be the full commit the module is built from, not "${commit}"`,
        );
      const { version } = JSON.parse(
        readFileSync(join(root, 'package.json'), 'utf8'),
      ) as {
        version: string;
      };
      const pin = JSON.parse(
        readFileSync(join(root, 'wasm', 'emscripten.json'), 'utf8'),
      ) as {
        version: string;
      };
      const metadata: EngineMetadata = {
        format: 1,
        engine: {
          version,
          abiNamespace: abiNamespace(version),
          sourceCommit: commit,
          sourceFingerprint: fingerprint,
        },
        variant: WEB_VARIANT,
        configuration: 'Release',
        target: { name: 'web', os: 'web', architectures: ['wasm32'] },
        toolchain: { compiler: 'Emscripten', compilerVersion: pin.version },
        protocol: checked.protocol,
        files: {
          wasm: { path: WASM_FILE, sha256: checked.sha256, size: checked.size },
        },
      };
      // Staged aside, then swapped in: a reader sees the old stage or the new.
      const stage = stageDirectory(root);
      const partial = `${stage}.${randomUUID()}.partial`;
      try {
        mkdirSync(join(partial, 'licenses', 'engine'), { recursive: true });
        copyFileSync(built, join(partial, WASM_FILE));
        copyFileSync(
          join(root, 'LICENSE'),
          join(partial, 'licenses', 'engine', 'LICENSE'),
        );
        copyFileSync(
          join(root, 'NOTICE.md'),
          join(partial, 'licenses', 'engine', 'NOTICE.md'),
        );
        cpSync(
          join(root, 'licenses', 'yoga'),
          join(partial, 'licenses', 'yoga'),
          {
            recursive: true,
          },
        );
        writeFileSync(
          join(partial, 'soundor-engine.json'),
          `${JSON.stringify(metadata, null, 2)}\n`,
        );
        removeDirectory(stage);
        renameSync(partial, stage);
      } finally {
        removeDirectory(partial);
      }
      return { wasm: join(stage, WASM_FILE), fingerprint };
    },
    {
      waiting: () =>
        context.log('waiting for another build of the WebAssembly core'),
    },
  );
}
