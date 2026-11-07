// Compiles the engine's Yoga to WebAssembly: its pinned revision, with the
// engine's patches, by a pinned wasi-sdk, which brings its own clang, wasm-ld,
// libc and libc++. Needs CMake (the patch script); no other tool.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXPORTS } from '../src/exports.ts';
import { engineCmake, yogaPin } from './inputs.mjs';

export const WASI_SDK = {
  version: '34.0',
  tag: 'wasi-sdk-34',
  // The release's own digests (GitHub's assets API).
  archives: {
    'x86_64-linux':
      'b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4',
    'arm64-linux':
      'f7e243dff54d60bcc576e94d6166b69f410f2500ae4a9ceef34315be10e77971',
    'x86_64-macos':
      '87d27fa8adc68dee59bfbf2e22a6d34ef717c34d6bf1d8af2a56fc929d9ce0eb',
    'arm64-macos':
      '9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9',
    'x86_64-windows':
      'cccb5c323a9b34f0349a9b09e8804a0a7632c68c3310f4b5f437ed57d7e71d8f',
    'arm64-windows':
      '45e1c71f3e965621e7b98ebe1d37b0e4b1f77f3e8072113ffb4534e67b1a4b7c',
  },
};

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const COMPILE_FLAGS = [
  '--target=wasm32-wasip1',
  '-std=c++20',
  '-Oz',
  '-flto',
  '-fno-exceptions',
  '-fno-rtti',
  '-fvisibility=hidden',
  '-DNDEBUG',
  '-mexec-model=reactor',
  '-w',
];

/** `<cpu>-<system>` as wasi-sdk names its archives. */
function sdkPlatform() {
  const cpu = { x64: 'x86_64', arm64: 'arm64' }[process.arch];
  const system = { linux: 'linux', darwin: 'macos', win32: 'windows' }[
    process.platform
  ];
  const platform = `${cpu}-${system}`;
  if (!(platform in WASI_SDK.archives))
    throw new Error(`wasi-sdk has no build for ${platform}`);
  return platform;
}

async function download(url, sha256, file) {
  const response = await fetch(url, { signal: AbortSignal.timeout(900_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha256)
    throw new Error(`${url} failed its SHA-256 check: ${actual}`);
  writeFileSync(file, bytes);
}

/** `url`'s archive extracted once into `directory`, which then only appears whole. */
async function extracted(url, sha256, directory, prepare = () => {}) {
  if (existsSync(directory)) return directory;
  const partial = `${directory}.${randomUUID()}.part`;
  mkdirSync(partial, { recursive: true });
  try {
    const archive = join(partial, 'archive.tar.gz');
    await download(url, sha256, archive);
    execFileSync('cmake', ['-E', 'tar', 'xzf', 'archive.tar.gz'], {
      cwd: partial,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    rmSync(archive);
    // Every archive here holds one top directory.
    const [top] = readdirSync(partial);
    prepare(join(partial, top));
    renameSync(join(partial, top), directory);
  } finally {
    rmSync(partial, { recursive: true, force: true });
  }
  return directory;
}

function cppSources(directory) {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.cpp'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/** Returns the module's bytes, by way of `output`. */
export async function compileYoga(cache, output) {
  const platform = sdkPlatform();
  const name = `wasi-sdk-${WASI_SDK.version}-${platform}`;
  const sdk = await extracted(
    `https://github.com/WebAssembly/wasi-sdk/releases/download/${WASI_SDK.tag}/${name}.tar.gz`,
    WASI_SDK.archives[platform],
    join(cache, name),
  );
  const pin = yogaPin();
  const yoga = await extracted(
    `https://github.com/facebook/yoga/archive/${pin.revision}.tar.gz`,
    pin.sha256,
    join(cache, `yoga-${pin.revision}`),
    (source) =>
      execFileSync(
        'cmake',
        [
          `-DSOURCE=${source}`,
          '-P',
          join(engineCmake, 'SoundorYogaPatch.cmake'),
        ],
        { stdio: ['ignore', 'ignore', 'inherit'] },
      ),
  );
  const clang = join(
    sdk,
    'bin',
    process.platform === 'win32' ? 'clang++.exe' : 'clang++',
  );
  const linkerFlags = [
    '--no-entry',
    '--strip-all',
    '--gc-sections',
    '--import-undefined',
    '--export=_initialize',
    ...EXPORTS.map((name) => `--export=${name}`),
  ];
  execFileSync(
    clang,
    [
      ...COMPILE_FLAGS,
      `-I${yoga}`,
      ...cppSources(join(yoga, 'yoga')),
      join(packageRoot, 'native/shim.cpp'),
      `-Wl,${linkerFlags.join(',')}`,
      '-o',
      output,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
}
