// Release-producing builds never consume ordinary compiled caches. This signed
// snapshot is either built fresh or restored after checking its builder identity.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const families = [
  'linux-clang',
  'macos-universal',
  'windows',
  'windows-static',
];
const script = fileURLToPath(import.meta.url);
const archiveTool = fileURLToPath(
  new URL('./verified-deps.py', import.meta.url),
);
const python = process.platform === 'win32' ? 'python' : 'python3';

export function dependencyKey(family, toolchain, files) {
  if (!families.includes(family)) throw new Error('Unknown dependency family');
  const hash = createHash('sha256').update(
    `verified-native-v1\0${family}\0${toolchain}\0`,
  );
  for (const [name, contents] of files.toSorted(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  ))
    hash
      .update(name)
      .update('\0')
      .update(contents.replaceAll('\r\n', '\n'))
      .update('\0');
  return `verified-native-${family}-${hash.digest('hex')}`;
}

function recipeFiles() {
  const files = [
    '.github/workflows/engine.yml',
    '.github/actions/setup/action.yml',
    '.github/actions/native-deps/action.yml',
    '.github/scripts/verified-deps.mjs',
    '.github/scripts/verified-deps.py',
    '.nvmrc',
  ];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (
        entry.isDirectory() &&
        (directory !== 'runtimes/engine/cmake' ||
          ['angle', 'hermes', 'skia'].includes(entry.name))
      )
        visit(path);
      else if (
        entry.isFile() &&
        (directory !== 'runtimes/engine/cmake' ||
          /^Soundor(?:Dependencies|Skia|Angle|Hermes|WindowsCrt|PlatformLibraries|AccessKit)/.test(
            entry.name,
          ))
      )
        files.push(path);
    }
  };
  visit('runtimes/engine/cmake');
  return files.map((path) => [path, readFileSync(path, 'utf8')]);
}

export async function findDependencies(
  key,
  { repository, token, fetcher = fetch, now = Date.now() },
) {
  const request = async (path) => {
    const response = await fetcher(
      `https://api.github.com/repos/${repository}${path}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Dependency artifact lookup: HTTP ${response.status}`);
    return response.json();
  };
  for (let page = 1; ; page++) {
    const value = await request(
      `/actions/artifacts?name=${encodeURIComponent(key)}&per_page=100&page=${page}`,
    );
    if (!value) return null;
    for (const artifact of value.artifacts) {
      if (
        artifact.name !== key ||
        artifact.expired ||
        !(Date.parse(artifact.expires_at) > now) ||
        Date.parse(artifact.created_at) < now - 14 * 86400000
      )
        continue;
      const id = artifact.workflow_run?.id;
      if (!Number.isSafeInteger(id)) continue;
      const run = await request(`/actions/runs/${id}`);
      if (
        !run ||
        run.conclusion !== 'success' ||
        run.status !== 'completed' ||
        run.head_branch !== 'main' ||
        run.head_repository?.full_name !== repository ||
        !['push', 'workflow_dispatch'].includes(run.event) ||
        ![
          '.github/workflows/release.yml',
          '.github/workflows/engine-prebuilts.yml',
        ].includes(run.path) ||
        !/^[a-f0-9]{40}$/.test(run.head_sha) ||
        artifact.workflow_run.head_sha !== run.head_sha ||
        !Number.isSafeInteger(artifact.id) ||
        !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '')
      )
        continue;
      return { id: artifact.id, commit: run.head_sha, digest: artifact.digest };
    }
    if (value.artifacts.length < 100) return null;
  }
}

export function verificationArgs(archive, bundle, repository, commit) {
  return [
    'attestation',
    'verify',
    archive,
    '--bundle',
    bundle,
    '--repo',
    repository,
    '--signer-workflow',
    `${repository}/.github/workflows/engine.yml`,
    '--source-ref',
    'refs/heads/main',
    '--source-digest',
    commit,
    '--signer-digest',
    commit,
    '--deny-self-hosted-runners',
  ];
}

export async function downloadTransport({
  candidate,
  directory,
  repository,
  token,
  fetcher = fetch,
}) {
  const response = await fetcher(
    `https://api.github.com/repos/${repository}/actions/artifacts/${candidate.id}/zip`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(10 * 60_000),
    },
  );
  if (!response.ok)
    throw new Error(`Dependency download: HTTP ${response.status}`);
  mkdirSync(directory, { recursive: true });
  const zip = join(directory, 'transport.zip');
  const hash = createHash('sha256');
  let size = 0;
  await pipeline(
    Readable.fromWeb(response.body),
    new Transform({
      transform(chunk, _encoding, done) {
        size += chunk.length;
        if (size > 3 * 1024 ** 3)
          return done(new Error('Dependency transport exceeds size limit'));
        hash.update(chunk);
        done(null, chunk);
      },
    }),
    createWriteStream(zip),
  );
  if (`sha256:${hash.digest('hex')}` !== candidate.digest)
    throw new Error('Dependency transport digest mismatch');
  return zip;
}

export async function restoreDependencies({
  candidate,
  identity,
  directory,
  cache,
  repository,
  token,
  fetcher = fetch,
  execute = execFileSync,
}) {
  const zip = await downloadTransport({
    candidate,
    directory,
    repository,
    token,
    fetcher,
  });
  const extracted = join(directory, 'verified');
  execute(python, [archiveTool, 'unwrap', zip, extracted]);
  // Do not read or extract the native archive before this succeeds.
  execute(
    'gh',
    verificationArgs(
      join(extracted, 'dependencies.tar.gz'),
      join(extracted, 'bundle.jsonl'),
      repository,
      candidate.commit,
    ),
    { stdio: 'inherit', env: { ...process.env, GH_TOKEN: token } },
  );
  execute(python, [
    archiveTool,
    'unpack',
    join(extracted, 'dependencies.tar.gz'),
    cache,
    identity.key,
  ]);
  rmSync(zip);
}

async function downloadCandidate(family, directory) {
  if (!families.includes(family)) throw new Error('Unknown dependency family');
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const name = `dependency-candidate-${process.env.GITHUB_SHA}-${family}`;
  for (let page = 1; ; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}/artifacts?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new Error(`Dependency candidate lookup: HTTP ${response.status}`);
    const { artifacts } = await response.json();
    const candidate = artifacts.find(
      (artifact) => artifact.name === name && !artifact.expired,
    );
    if (candidate) {
      if (
        !Number.isSafeInteger(candidate.id) ||
        !/^sha256:[a-f0-9]{64}$/.test(candidate.digest ?? '')
      )
        throw new Error(
          'Dependency candidate has no immutable transport digest',
        );
      const zip = await downloadTransport({
        candidate,
        directory,
        repository,
        token,
      });
      execFileSync(python, [
        archiveTool,
        'unwrap-candidate',
        zip,
        join(process.env.RUNNER_TEMP, 'dependency-candidate'),
      ]);
      return;
    }
    if (artifacts.length < 100)
      throw new Error('Missing dependency signing candidate');
  }
}

function identify(family, target, directory) {
  if (!families.includes(family)) throw new Error('Unknown dependency family');
  const probe = join(directory, 'toolchain');
  mkdirSync(probe, { recursive: true });
  const fields = [
    'CMAKE_VERSION',
    'CMAKE_C_COMPILER_ID',
    'CMAKE_C_COMPILER_VERSION',
    'CMAKE_C_COMPILER',
    'CMAKE_CXX_COMPILER_ID',
    'CMAKE_CXX_COMPILER_VERSION',
    'CMAKE_CXX_COMPILER',
    'CMAKE_GENERATOR',
    'CMAKE_GENERATOR_TOOLSET',
    'CMAKE_VS_WINDOWS_TARGET_PLATFORM_VERSION',
    'CMAKE_OSX_SYSROOT',
    'CMAKE_OSX_DEPLOYMENT_TARGET',
    'CMAKE_C_FLAGS',
    'CMAKE_CXX_FLAGS',
    'CMAKE_EXE_LINKER_FLAGS',
    'CMAKE_C_FLAGS_RELEASE',
    'CMAKE_CXX_FLAGS_RELEASE',
    'CMAKE_C_FLAGS_DEBUG',
    'CMAKE_CXX_FLAGS_DEBUG',
    'CMAKE_LINKER',
    'CMAKE_AR',
  ];
  writeFileSync(
    join(probe, 'CMakeLists.txt'),
    `cmake_minimum_required(VERSION 3.22)\nproject(DependencyToolchain LANGUAGES C CXX)\nfile(WRITE "\${CMAKE_BINARY_DIR}/identity.txt" "${fields.map((field) => `${field}=\${${field}}`).join('\n')}\n")\n`,
  );
  const build = join(probe, 'build');
  execFileSync('cmake', ['-S', probe, '-B', build], { stdio: 'inherit' });
  const sdk =
    process.platform === 'darwin'
      ? execFileSync('xcrun', ['--show-sdk-version'], {
          encoding: 'utf8',
        }).trim()
      : '';
  const toolchain = `${target}\n${process.env.ImageOS ?? ''}\n${process.env.ImageVersion ?? ''}\n${process.env.SOUNDOR_XCODE ?? ''}\n${sdk}\n${readFileSync(join(build, 'identity.txt'), 'utf8').replaceAll('\r\n', '\n')}`;
  const key = dependencyKey(family, toolchain, recipeFiles());
  const identity = {
    format: 1,
    key,
    family,
    target,
    toolchain,
    sourceCommit: process.env.GITHUB_SHA,
  };
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'identity.json'), JSON.stringify(identity));
  return identity;
}

async function main() {
  const [command, family, target] = process.argv.slice(2);
  const directory = join(process.env.RUNNER_TEMP, 'verified-dependencies');
  if (command === 'identify') {
    const identity = identify(family, target, directory);
    console.log(`Verified dependency identity: ${identity.key}`);
  } else if (command === 'restore') {
    const identity = JSON.parse(
      readFileSync(join(directory, 'identity.json'), 'utf8'),
    );
    const repository = process.env.GITHUB_REPOSITORY;
    const token = process.env.GITHUB_TOKEN;
    if (!repository || !token)
      throw new Error('Missing dependency artifact credentials');
    const candidate = await findDependencies(identity.key, {
      repository,
      token,
    });
    if (!candidate) {
      console.log('No verified dependencies: compiling from clean sources');
      return;
    }
    await restoreDependencies({
      candidate,
      identity,
      directory,
      cache: process.env.SOUNDOR_CACHE,
      repository,
      token,
    });
    console.log(
      `Verified dependencies restored from main commit ${candidate.commit}`,
    );
  } else if (command === 'candidate') {
    await downloadCandidate(family, directory);
  } else if (command === 'package') {
    execFileSync(
      python,
      [
        archiveTool,
        'package',
        process.env.SOUNDOR_CACHE,
        join(process.env.RUNNER_TEMP, 'dependency-candidate'),
        join(directory, 'identity.json'),
      ],
      { stdio: 'inherit' },
    );
  } else if (command === 'inspect') {
    const identity = JSON.parse(
      readFileSync(
        join(process.env.RUNNER_TEMP, 'dependency-candidate/identity.json'),
        'utf8',
      ),
    );
    if (
      identity.format !== 1 ||
      !/^verified-native-[a-z0-9-]+-[a-f0-9]{64}$/.test(identity.key) ||
      identity.sourceCommit !== process.env.GITHUB_SHA
    )
      throw new Error('Invalid dependency signing candidate');
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `key=${identity.key}\n`);
  } else throw new Error('Unknown verified dependency operation');
}
if (process.argv[1] && resolve(process.argv[1]) === script) await main();
