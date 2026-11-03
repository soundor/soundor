// Release tooling of @soundor/vst3-host (README, "Releases"). The platform
// packages are generated here, never committed and never Changesets
// workspaces; each takes the main package's exact version.
//
//   stage <executable> --target <t> --commit <sha> --out <dir>
//       a built executable as a CI artifact: bin/, licenses/, provenance
//   planned <publish-plan.json>
//       whether the Changesets plan publishes @soundor/vst3-host (host=…)
//   generate <artifacts> --out <dir> [--commit <sha>]
//       one platform package per target in targets.json, from <artifacts>/<target>
//   pack <packages> --out <dir>
//       npm pack each, then check the tarballs
//   check <tarballs> [--commit <sha>]
//       the tarballs that will be published: names, versions, platforms,
//       executables (mode, SHA-256), provenance, notices
//   add-optional-dependencies
//       pins every platform package, exactly, in package.json (CI only;
//       never committed)
//   check-main <pack dir>
//       the packed main package pins them and carries no executable
//   publish <tarballs>
//       publishes what is missing, verifies what exists, never overwrites
//   verify <tarballs>
//       every platform package of this version is on npm, as expected
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { nativeInputs } from '../src/inputs.ts';
import {
  type Fetch,
  NPM_REGISTRY,
  RegistryError,
  downloadTarball,
  readTarball,
  versionMetadata,
} from '../src/npm.ts';
import { PROTOCOL_VERSION } from '../src/protocol.ts';
import {
  PROVENANCE_FILE,
  type Provenance,
  checkedProvenance,
  requiredGlibc,
  sameIdentity,
  sha256,
} from '../src/provenance.ts';
import {
  type Target,
  ownManifest,
  packageRoot,
  targets,
} from '../src/targets.ts';

const MAIN = '@soundor/vst3-host';

function targetNamed(name: string): Target {
  const target = targets.find((entry) => entry.target === name);
  if (!target)
    throw new Error(
      `${name} is not a target of targets.json (${targets.map((t) => t.target).join(', ')})`,
    );
  return target;
}

function files(directory: string, base = directory): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? files(path, base)
        : [relative(base, path).split(sep).join('/')];
    });
}

// ── Stage ───────────────────────────────────────────────────────────────

export function stage(options: {
  executable: string;
  target: string;
  commit: string | null;
  out: string;
  /** The build's licenses/ directory. Default: next to bin/. */
  licenses?: string;
  root?: string;
}): Provenance {
  const root = options.root ?? packageRoot;
  const target = targetNamed(options.target);
  if (options.commit !== null && !/^[0-9a-f]{40}$/.test(options.commit))
    throw new Error(`--commit is a full commit hash, not "${options.commit}"`);
  const licenses =
    options.licenses ?? join(dirname(dirname(options.executable)), 'licenses');
  if (!existsSync(join(licenses, 'vst3sdk', 'LICENSE.txt')))
    throw new Error(
      `${licenses} has no vst3sdk/LICENSE.txt; stage a CMake build of the host`,
    );
  rmSync(options.out, { recursive: true, force: true });
  mkdirSync(join(options.out, dirname(target.executable)), { recursive: true });
  const executable = join(options.out, target.executable);
  copyFileSync(options.executable, executable);
  chmodSync(executable, 0o755);
  cpSync(licenses, join(options.out, 'licenses'), { recursive: true });
  const bytes = readFileSync(executable);
  const { fingerprint, version } = nativeInputs(root);
  const glibc = target.libc?.includes('glibc')
    ? requiredGlibc(bytes)
    : undefined;
  const provenance: Provenance = {
    format: 1,
    name: MAIN,
    version,
    protocol: PROTOCOL_VERSION,
    target: target.target,
    architectures: target.architectures,
    configuration: 'Release',
    sourceCommit: options.commit,
    sourceFingerprint: fingerprint,
    executable: {
      path: target.executable,
      sha256: sha256(bytes),
      size: bytes.length,
    },
    ...(glibc ? { glibc } : {}),
  };
  writeFileSync(
    join(options.out, PROVENANCE_FILE),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  return provenance;
}

// ── The publish plan ────────────────────────────────────────────────────

export function plannedHost(publishPlan: unknown): string | null {
  const plan = publishPlan as { version?: number; plan?: unknown[] };
  if (plan?.version !== 1 || !Array.isArray(plan.plan))
    throw new Error('Unknown Changesets publish plan format');
  const entry = (
    plan.plan.flat() as { kind?: string; name?: string; version?: string }[]
  ).find((item) => item.kind === 'publish' && item.name === MAIN);
  return entry?.version ?? null;
}

// ── Platform packages ───────────────────────────────────────────────────

function platformManifest(
  target: Target,
  version: string,
  repository: unknown,
) {
  return {
    name: target.package,
    version,
    description: `The ${target.target} executable of ${MAIN}; installed by it, not used directly.`,
    license: 'MIT',
    repository,
    os: target.os,
    cpu: target.cpu,
    ...(target.libc ? { libc: target.libc } : {}),
    files: [
      'bin',
      'licenses',
      PROVENANCE_FILE,
      'README.md',
      'LICENSE',
      'NOTICE.md',
    ],
    preferUnplugged: true,
  };
}

/** Every target's artifact, checked as one set: one version, one commit,
    one set of native inputs. */
export function generate(options: {
  artifacts: string;
  out: string;
  commit?: string;
  root?: string;
}): Provenance[] {
  const root = options.root ?? packageRoot;
  const manifest = ownManifest(root) as ReturnType<typeof ownManifest> & {
    repository?: unknown;
  };
  const result: Provenance[] = [];
  rmSync(options.out, { recursive: true, force: true });
  for (const target of targets) {
    const artifact = join(options.artifacts, target.target);
    const file = join(artifact, PROVENANCE_FILE);
    if (!existsSync(file))
      throw new Error(`No ${target.target} artifact in ${artifact}`);
    const provenance = checkedProvenance(
      JSON.parse(readFileSync(file, 'utf8')),
      file,
    );
    const problems: string[] = [];
    if (provenance.target !== target.target)
      problems.push(`it is for ${provenance.target}`);
    if (provenance.version !== manifest.version)
      problems.push(
        `it is version ${provenance.version}, not ${manifest.version}`,
      );
    if (provenance.protocol !== PROTOCOL_VERSION)
      problems.push(`it speaks protocol ${provenance.protocol}`);
    if (options.commit && provenance.sourceCommit !== options.commit)
      problems.push(
        `it was built from ${provenance.sourceCommit}, not ${options.commit}`,
      );
    if (
      result[0] &&
      provenance.sourceFingerprint !== result[0].sourceFingerprint
    )
      problems.push("its native inputs differ from the other targets'");
    const bytes = readFileSync(join(artifact, provenance.executable.path));
    if (sha256(bytes) !== provenance.executable.sha256)
      problems.push('its executable does not match its SHA-256');
    if (problems.length)
      throw new Error(
        `The ${target.target} artifact is not releasable: ${problems.join('; ')}`,
      );

    const directory = join(options.out, target.target);
    mkdirSync(directory, { recursive: true });
    cpSync(artifact, directory, { recursive: true });
    chmodSync(join(directory, provenance.executable.path), 0o755);
    writeFileSync(
      join(directory, 'package.json'),
      `${JSON.stringify(platformManifest(target, manifest.version, manifest.repository), null, 2)}\n`,
    );
    copyFileSync(join(root, 'LICENSE'), join(directory, 'LICENSE'));
    copyFileSync(join(root, 'NOTICE.md'), join(directory, 'NOTICE.md'));
    writeFileSync(
      join(directory, 'README.md'),
      `# ${target.package}\n\nThe ${target.target} executable of [${MAIN}](https://www.npmjs.com/package/${MAIN}), which installs it as an optional dependency of the same version. Install ${MAIN}, not this package.\n\nSoundor's code is MIT-licensed; the executable includes the VST3 SDK (MIT, see licenses/vst3sdk).\n`,
    );
    result.push(provenance);
  }
  return result;
}

export function pack(packages: string, out: string): string[] {
  mkdirSync(out, { recursive: true });
  return targets.map((target) => {
    const output = execFileSync(
      'npm',
      ['pack', '--json', '--pack-destination', resolve(out)],
      {
        cwd: join(packages, target.target),
        encoding: 'utf8',
        shell: process.platform === 'win32',
      },
    );
    const [{ filename }] = JSON.parse(output) as [{ filename: string }];
    return join(out, basename(filename));
  });
}

export interface CheckedTarball {
  path: string;
  target: Target;
  provenance: Provenance;
}

/** The tarballs as they will be published: exactly the targets, the same
    version, commit and inputs, right metadata, an intact executable. */
export function checkTarballs(
  directory: string,
  expected: { version: string; commit?: string },
): CheckedTarball[] {
  const found = files(directory).filter((path) => path.endsWith('.tgz'));
  const checked: CheckedTarball[] = [];
  for (const target of targets) {
    const name = `${target.package.replace('@', '').replace('/', '-')}-${expected.version}.tgz`;
    if (!found.includes(name)) throw new Error(`${directory} has no ${name}`);
    const path = join(directory, name);
    const entries = readTarball(readFileSync(path));
    const read = (file: string) => entries.find((entry) => entry.path === file);
    const problems: string[] = [];
    const manifestEntry = read('package.json');
    const manifest = manifestEntry
      ? JSON.parse(manifestEntry.data.toString('utf8'))
      : {};
    if (manifest.name !== target.package)
      problems.push(`it is named ${manifest.name}`);
    if (manifest.version !== expected.version)
      problems.push(`it is version ${manifest.version}`);
    for (const field of ['os', 'cpu', 'libc'] as const)
      if (JSON.stringify(manifest[field]) !== JSON.stringify(target[field]))
        problems.push(
          `its ${field} is ${JSON.stringify(manifest[field])}, not ${JSON.stringify(target[field])}`,
        );
    if (manifest.scripts && Object.keys(manifest.scripts).length)
      problems.push(
        'it has scripts (an installed platform package runs nothing)',
      );
    const record = read(PROVENANCE_FILE);
    let provenance: Provenance | undefined;
    if (!record) problems.push(`it has no ${PROVENANCE_FILE}`);
    else {
      try {
        provenance = checkedProvenance(
          JSON.parse(record.data.toString('utf8')),
          PROVENANCE_FILE,
        );
        if (provenance.version !== expected.version)
          problems.push(`its provenance says ${provenance.version}`);
        if (provenance.target !== target.target)
          problems.push(`its provenance says ${provenance.target}`);
        if (expected.commit && provenance.sourceCommit !== expected.commit)
          problems.push(`it was built from ${provenance.sourceCommit}`);
        if (
          checked[0] &&
          provenance.sourceFingerprint !==
            checked[0].provenance.sourceFingerprint
        )
          problems.push("its native inputs differ from the other targets'");
      } catch (error) {
        problems.push((error as Error).message);
      }
    }
    const executable = read(target.executable);
    if (!executable || executable.type !== 'file')
      problems.push(`it has no ${target.executable}`);
    else {
      if ((executable.mode & 0o111) !== 0o111)
        problems.push(`${target.executable} is not executable`);
      if (
        provenance &&
        sha256(executable.data) !== provenance.executable.sha256
      )
        problems.push(`${target.executable} does not match its provenance`);
    }
    for (const notice of [
      'LICENSE',
      'NOTICE.md',
      'licenses/vst3sdk/LICENSE.txt',
    ])
      if (!read(notice)) problems.push(`it has no ${notice}`);
    const unexpected = entries
      .filter((entry) => entry.type === 'file')
      .map((entry) => entry.path)
      .filter(
        (file) =>
          ![
            'package.json',
            'README.md',
            'LICENSE',
            'NOTICE.md',
            PROVENANCE_FILE,
            target.executable,
          ].includes(file) && !file.startsWith('licenses/'),
      );
    if (unexpected.length)
      problems.push(`it carries unexpected files: ${unexpected.join(', ')}`);
    if (problems.length)
      throw new Error(`${name} is not publishable: ${problems.join('; ')}`);
    checked.push({ path, target, provenance: provenance! });
  }
  const extra = found.filter(
    (file) => !checked.some((entry) => basename(entry.path) === file),
  );
  if (extra.length)
    throw new Error(
      `${directory} has tarballs no target expects: ${extra.join(', ')}`,
    );
  return checked;
}

// ── The main package ────────────────────────────────────────────────────

export function addOptionalDependencies(
  root = packageRoot,
): Record<string, string> {
  const path = join(root, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.optionalDependencies = Object.fromEntries(
    targets.map((target) => [target.package, manifest.version]),
  );
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest.optionalDependencies;
}

export function checkMain(directory: string, version: string): void {
  const tarballs = files(directory).filter((path) =>
    /(^|\/)soundor-vst3-host-\d[^/]*\.tgz$/.test(path),
  );
  if (tarballs.length !== 1)
    throw new Error(
      `Expected one packed ${MAIN} in ${directory}, found ${tarballs.length}`,
    );
  const entries = readTarball(readFileSync(join(directory, tarballs[0]!)));
  const manifest = JSON.parse(
    entries
      .find((entry) => entry.path === 'package.json')!
      .data.toString('utf8'),
  );
  const problems: string[] = [];
  if (manifest.version !== version)
    problems.push(`it is version ${manifest.version}`);
  for (const target of targets)
    if (manifest.optionalDependencies?.[target.package] !== version)
      problems.push(`it does not pin ${target.package} to exactly ${version}`);
  if (
    Object.keys(manifest.optionalDependencies ?? {}).length !== targets.length
  )
    problems.push('it has other optional dependencies');
  if (
    manifest.scripts?.postinstall ||
    manifest.scripts?.install ||
    manifest.scripts?.preinstall
  )
    problems.push('it has an install script');
  const binaries = entries.filter((entry) =>
    /(^|\/)(build|bin)\/|\.(exe|so|dylib|dll|node)$/.test(entry.path),
  );
  if (binaries.length)
    problems.push(
      `it carries build output: ${binaries.map((e) => e.path).join(', ')}`,
    );
  if (problems.length)
    throw new Error(
      `The packed ${MAIN} is not publishable: ${problems.join('; ')}`,
    );
}

// ── Publishing ──────────────────────────────────────────────────────────

export type Publisher = (tarball: string) => Promise<void>;

export const npmPublish: Publisher = async (tarball) => {
  const result = spawnSync(
    'npm',
    ['publish', resolve(tarball), '--access', 'public'],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );
  if (result.status !== 0)
    throw new Error(
      `npm publish ${basename(tarball)} failed (exit ${result.status})`,
    );
};

export type Outcome = 'published' | 'verified';

/** What the registry holds for a target's version: nothing (404), or a
    version whose identity is checked against `expected`. Anything else
    (network, authentication, server, integrity) throws. */
async function registryState(
  checked: CheckedTarball,
  context: { registry: string; fetcher: Fetch },
): Promise<'missing' | 'matching'> {
  const { target, provenance } = checked;
  const metadata = await versionMetadata(
    target.package,
    provenance.version,
    context,
  );
  if (metadata === null) return 'missing';
  const entries = readTarball(await downloadTarball(metadata, context));
  const record = entries.find((entry) => entry.path === PROVENANCE_FILE);
  if (!record)
    throw new Error(
      `${target.package}@${provenance.version} is on npm without ${PROVENANCE_FILE}; it cannot be verified`,
    );
  const published = checkedProvenance(
    JSON.parse(record.data.toString('utf8')),
    `the published ${target.package}`,
  );
  const binary = entries.find(
    (entry) => entry.path === published.executable.path,
  );
  if (!binary || sha256(binary.data) !== published.executable.sha256)
    throw new Error(
      `${target.package}@${provenance.version} on npm does not match its own provenance`,
    );
  if (!sameIdentity(published, provenance))
    throw new Error(
      `${target.package}@${provenance.version} is already published from other native inputs (${published.sourceCommit ?? 'unknown commit'}, ${published.sourceFingerprint.slice(0, 12)}); it is never overwritten. Release a new version.`,
    );
  return 'matching';
}

/** Resumable: publishes the missing versions, verifies the present ones,
    and fails on a conflicting or unverifiable one. Publishes nothing until
    every target's state is known. */
export async function publish(
  tarballs: CheckedTarball[],
  {
    registry = NPM_REGISTRY,
    fetcher = fetch,
    publisher = npmPublish,
    log = console.log,
  }: {
    registry?: string;
    fetcher?: Fetch;
    publisher?: Publisher;
    log?: (message: string) => void;
  } = {},
): Promise<Record<string, Outcome>> {
  const context = { registry, fetcher };
  const states = new Map<CheckedTarball, 'missing' | 'matching'>();
  for (const tarball of tarballs)
    states.set(tarball, await registryState(tarball, context));
  const outcomes: Record<string, Outcome> = {};
  for (const tarball of tarballs) {
    const name = `${tarball.target.package}@${tarball.provenance.version}`;
    if (states.get(tarball) === 'matching') {
      log(`${name}: already published and verified`);
      outcomes[tarball.target.package] = 'verified';
      continue;
    }
    try {
      await publisher(tarball.path);
    } catch (error) {
      // Another run may have published it meanwhile: success only if what
      // is there now is verifiably the same build.
      let state: 'missing' | 'matching';
      try {
        state = await registryState(tarball, context);
      } catch (verifyError) {
        throw new Error(
          `${name}: publishing failed (${(error as Error).message}) and ${(verifyError as Error).message}`,
          {
            cause: error,
          },
        );
      }
      if (state !== 'matching') throw error;
      log(`${name}: published concurrently; verified`);
      outcomes[tarball.target.package] = 'verified';
      continue;
    }
    log(`${name}: published`);
    outcomes[tarball.target.package] = 'published';
  }
  return outcomes;
}

/** After publishing, before the main package: every target is on npm and
    verifiably the expected build. */
export async function verify(
  tarballs: CheckedTarball[],
  {
    registry = NPM_REGISTRY,
    fetcher = fetch,
  }: { registry?: string; fetcher?: Fetch } = {},
): Promise<void> {
  const missing: string[] = [];
  for (const tarball of tarballs)
    if ((await registryState(tarball, { registry, fetcher })) === 'missing')
      missing.push(`${tarball.target.package}@${tarball.provenance.version}`);
  if (missing.length) throw new Error(`Not on npm yet: ${missing.join(', ')}`);
}

// ── CLI ─────────────────────────────────────────────────────────────────

async function main(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      target: { type: 'string' },
      commit: { type: 'string' },
      out: { type: 'string' },
      licenses: { type: 'string' },
    },
  });
  const [command, argument] = positionals;
  const required = (value: string | undefined, name: string) => {
    if (!value) throw new Error(`${command} needs ${name}`);
    return value;
  };
  const version = ownManifest().version;
  switch (command) {
    case 'stage':
      console.log(
        JSON.stringify(
          stage({
            executable: required(argument, '<executable>'),
            target: required(values.target, '--target'),
            commit: values.commit ?? null,
            out: required(values.out, '--out'),
            licenses: values.licenses,
          }),
          null,
          2,
        ),
      );
      break;
    case 'planned': {
      const planned = plannedHost(
        JSON.parse(readFileSync(required(argument, '<publish plan>'), 'utf8')),
      );
      if (planned !== null && planned !== version)
        throw new Error(
          `The publish plan publishes ${MAIN} ${planned}; the checkout is ${version}`,
        );
      const line = `host=${planned !== null}`;
      console.log(line);
      if (process.env.GITHUB_OUTPUT)
        writeFileSync(process.env.GITHUB_OUTPUT, `${line}\n`, { flag: 'a' });
      break;
    }
    case 'generate':
      generate({
        artifacts: required(argument, '<artifacts>'),
        out: required(values.out, '--out'),
        commit: values.commit,
      });
      break;
    case 'pack': {
      const out = required(values.out, '--out');
      pack(required(argument, '<packages>'), out);
      checkTarballs(out, { version, commit: values.commit });
      console.log(
        `Packed and checked ${targets.length} platform packages in ${out}`,
      );
      break;
    }
    case 'check':
      checkTarballs(required(argument, '<tarballs>'), {
        version,
        commit: values.commit,
      });
      console.log('The platform packages are publishable');
      break;
    case 'add-optional-dependencies':
      console.log(addOptionalDependencies());
      break;
    case 'check-main':
      checkMain(required(argument, '<pack dir>'), version);
      console.log(`The packed ${MAIN} pins its platform packages`);
      break;
    case 'publish':
      await publish(
        checkTarballs(required(argument, '<tarballs>'), {
          version,
          commit: values.commit,
        }),
      );
      break;
    case 'verify':
      await verify(
        checkTarballs(required(argument, '<tarballs>'), {
          version,
          commit: values.commit,
        }),
      );
      console.log(`Every platform package of ${MAIN} ${version} is on npm`);
      break;
    default:
      throw new Error(
        `Unknown command ${command}; see the comment at the top of scripts/release.ts`,
      );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      error instanceof RegistryError
        ? `registry: ${error.message}`
        : (error as Error).message,
    );
    process.exitCode = 1;
  });
}
