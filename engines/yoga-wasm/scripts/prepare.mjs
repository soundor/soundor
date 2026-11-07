// Finds the module for this checkout's inputs, and writes `generated/`, which
// the build bundles and ships. In order: this machine's cache, the published
// package when its inputs are the same, and otherwise a compile (compile.mjs).
//
// A failure to reach npm is an error, never a reason to compile: that would
// hide a broken network behind a 200 MB download. SOUNDOR_YOGA_WASM=source
// compiles without asking npm, for working offline with a wasi-sdk in the cache.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
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

  if (env.SOUNDOR_YOGA_WASM !== 'source') {
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
  const { file, source } = await resolveModule(inputs, env);
  const generated = join(packageRoot, 'generated');
  mkdirSync(generated, { recursive: true });
  const bytes = readFileSync(file);
  copyFileSync(file, join(generated, 'yoga.wasm'));
  writeFileSync(
    join(generated, 'build.json'),
    `${JSON.stringify(
      {
        format: 1,
        fingerprint: inputs.fingerprint,
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
