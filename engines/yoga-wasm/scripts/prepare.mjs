// Finds the module for this checkout's inputs, and writes `generated/`, which
// the build bundles and ships. In order: this machine's cache, the published
// package when its inputs are the same, and otherwise a compile (compile.mjs).
//
// A failure to reach npm is an error, never a reason to compile: that would
// hide a broken network behind a 200 MB download.
//
// SOUNDOR_YOGA_WASM chooses otherwise:
// - `source` compiles without asking npm, for working offline with a wasi-sdk in
//   the cache.
// - `release` is what a release builds with: it trusts no cache, compiling from
//   the pinned downloads in a directory of its own. A published module of the
//   same inputs has to be these very bytes, or the release stops.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { yogaInputs } from './inputs.mjs';

const REGISTRY = 'https://registry.npmjs.org/';
const PACKAGE = '@soundor/yoga-wasm';
const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Where Soundor keeps what it builds: as SoundorDependencies.cmake finds it. */
export function soundorCache(env = process.env) {
  if (env.SOUNDOR_CACHE) return env.SOUNDOR_CACHE;
  if (process.platform === 'win32' && env.LOCALAPPDATA)
    return join(env.LOCALAPPDATA, 'soundor');
  if (process.platform === 'darwin')
    return join(homedir(), 'Library/Caches/soundor');
  if (env.XDG_CACHE_HOME) return join(env.XDG_CACHE_HOME, 'soundor');
  return join(homedir(), '.cache/soundor');
}

/** Regular files of an npm archive, by name, without touching the filesystem. */
export function readTarball(tarball, names) {
  const tar = gunzipSync(tarball, { maxOutputLength: 64 * 1024 * 1024 });
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.toString('utf8', 0, 100).split('\0')[0];
    const size = Number.parseInt(
      header.toString('ascii', 124, 136).replaceAll('\0', '').trim(),
      8,
    );
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + 512 + size > tar.length
    )
      throw new Error(`Invalid ${PACKAGE} npm archive`);
    if (names.includes(name) && [0, 48].includes(header[156]))
      files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function request(url, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok && response.status !== 404)
    throw new Error(`HTTP ${response.status}: ${url}`);
  return response;
}

/** What npm has as the package's latest version, or null: not published yet. */
export async function latestPackage(fetcher = fetch) {
  const metadata = await request(
    `${REGISTRY}${encodeURIComponent(PACKAGE)}/latest`,
    fetcher,
  );
  if (metadata.status === 404) return null;
  const pkg = await metadata.json();
  if (pkg.name !== PACKAGE || !pkg.dist?.integrity?.startsWith('sha512-'))
    throw new Error(`${PACKAGE}'s npm metadata has no SHA-512 integrity`);
  return pkg;
}

/**
 * The published module if its inputs are `fingerprint`, or null: not published
 * yet, or built from other inputs.
 */
export async function publishedModule(fingerprint, fetcher = fetch) {
  const pkg = await latestPackage(fetcher);
  if (pkg === null) return null;
  const url = new URL(pkg.dist.tarball);
  if (url.href.startsWith(REGISTRY) === false)
    throw new Error(`${PACKAGE}'s archive must come from ${REGISTRY}`);
  const archive = await request(url.href, fetcher);
  if (!archive.ok) throw new Error(`${PACKAGE}'s archive is missing: ${url}`);
  const bytes = Buffer.from(await archive.arrayBuffer());
  const expected = Buffer.from(pkg.dist.integrity.slice(7), 'base64');
  const actual = createHash('sha512').update(bytes).digest();
  if (expected.length !== actual.length || !timingSafeEqual(actual, expected))
    throw new Error(`${PACKAGE}'s archive failed its SHA-512 integrity check`);
  const files = readTarball(bytes, [
    'package/dist/build.json',
    'package/dist/yoga.wasm',
  ]);
  const build = files.get('package/dist/build.json');
  const module = files.get('package/dist/yoga.wasm');
  if (build === undefined || module === undefined)
    throw new Error(`${PACKAGE}@${pkg.version} has no module`);
  if (JSON.parse(build.toString('utf8')).fingerprint !== fingerprint)
    return null;
  return Buffer.from(module);
}

/** The way a build finds its module; anything unknown is a mistake. */
export function moduleMode(env = process.env) {
  const mode = env.SOUNDOR_YOGA_WASM || 'default';
  if (!['default', 'source', 'release'].includes(mode))
    throw new Error(`Unknown SOUNDOR_YOGA_WASM: ${mode}`);
  return mode;
}

/** What is wrong with what a release compiled, given the published module. */
export function publishedProblem(compiled, published) {
  if (published === null || published.equals(compiled)) return null;
  return `${PACKAGE}: the published module has these inputs but other bytes than this compile. One of them is not what its inputs make: do not release until that is understood.`;
}

/** A release's module: from nothing but the pinned downloads. */
async function releaseModule({ fingerprint }) {
  const { compileYoga } = await import('./compile.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'soundor-yoga-wasm-'));
  try {
    console.log(
      `${PACKAGE}: compiling Yoga for a release, from nothing cached`,
    );
    const file = join(directory, 'yoga.wasm');
    await compileYoga(directory, file);
    const bytes = readFileSync(file);
    const problem = publishedProblem(bytes, await publishedModule(fingerprint));
    if (problem !== null) throw new Error(problem);
    return bytes;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function resolveModule({ fingerprint }, env) {
  const root = join(soundorCache(env), 'yoga-wasm');
  const cached = join(root, fingerprint, 'yoga.wasm');
  if (existsSync(cached)) return { file: cached, source: 'cache' };

  const store = (write) => {
    mkdirSync(dirname(cached), { recursive: true });
    const partial = `${cached}.${randomUUID()}.part`;
    try {
      write(partial);
      renameSync(partial, cached);
    } finally {
      rmSync(partial, { force: true });
    }
    return cached;
  };

  if (moduleMode(env) !== 'source') {
    let module;
    try {
      module = await publishedModule(fingerprint);
    } catch (error) {
      throw new Error(
        `Could not ask npm for ${PACKAGE}: ${error.message}. To compile offline, set SOUNDOR_YOGA_WASM=source.`,
        { cause: error },
      );
    }
    if (module !== null)
      return {
        file: store((partial) => writeFileSync(partial, module)),
        source: 'npm',
      };
  }
  const { compileYoga } = await import('./compile.mjs');
  mkdirSync(root, { recursive: true });
  console.log(
    `${PACKAGE}: compiling Yoga (inputs ${fingerprint.slice(0, 12)})`,
  );
  const compiled = join(root, `${randomUUID()}.wasm`);
  try {
    await compileYoga(root, compiled);
    return {
      file: store((partial) => copyFileSync(compiled, partial)),
      source: 'compiled',
    };
  } finally {
    rmSync(compiled, { force: true });
  }
}

export async function prepare(env = process.env) {
  const inputs = yogaInputs();
  let bytes;
  let source;
  if (moduleMode(env) === 'release') {
    bytes = await releaseModule(inputs);
    source = 'release';
  } else {
    const found = await resolveModule(inputs, env);
    bytes = readFileSync(found.file);
    source = found.source;
  }
  const generated = join(packageRoot, 'generated');
  mkdirSync(generated, { recursive: true });
  writeFileSync(join(generated, 'yoga.wasm'), bytes);
  writeFileSync(
    join(generated, 'build.json'),
    `${JSON.stringify(
      {
        format: 1,
        fingerprint: inputs.fingerprint,
        // How this build came by it; `release` in what is published.
        source,
        yoga: inputs.pin.version,
        yogaRevision: inputs.pin.revision,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(generated, 'yoga-wasm.ts'),
    `export default '${bytes.toString('base64')}';\n`,
  );
  console.log(`${PACKAGE}: ${bytes.length} bytes, from ${source}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await prepare();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
