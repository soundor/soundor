/**
 * Separate copies of the Soundor packages working together, as installs make
 * them: the CLI's `@soundor/config` and `@soundor/core` on one side, a
 * third-party runtime with its own `@soundor/runtime-sdk`, `@soundor/config`
 * and `@soundor/core` (of the same or another version) on the other.
 *
 * Each copy is bundled from source into its own `node_modules` tree, and the
 * scenario runs in a child Node process, so modules resolve and load as they
 * do in a project: two copies really are two module instances, with their own
 * classes.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rolldown } from 'rolldown';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CONFIG_SCHEMA_VERSION, CONFIG_VERSION, CORE_VERSION } from './index';

const PLACEHOLDER = '0.0.0-soundor-copy';

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Where `name` is installed for the package at `from`, as Node finds it. */
function installed(from: string, name: string): string {
  return realpathSync(join(from, 'node_modules', name));
}
const configRoot = installed(sdkRoot, '@soundor/config');
const coreRoot = installed(configRoot, '@soundor/core');
/** Third-party packages the copies import, linked into every tree. */
const shared = {
  zod: installed(configRoot, 'zod'),
  rolldown: installed(configRoot, 'rolldown'),
};

type Package = 'core' | 'config' | 'runtime-sdk';
const sources: Record<Package, { name: string; entry: string }> = {
  core: { name: '@soundor/core', entry: join(coreRoot, 'src/index.ts') },
  config: { name: '@soundor/config', entry: join(configRoot, 'src/index.ts') },
  'runtime-sdk': {
    name: '@soundor/runtime-sdk',
    entry: join(sdkRoot, 'src/index.ts'),
  },
};
/** Each package bundled once, its version a placeholder set per copy. */
const bundles = {} as Record<Package, string>;

let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'soundor-copies-'));
  for (const [key, { entry }] of Object.entries(sources)) {
    const bundle = await rolldown({
      input: entry,
      // Bare imports (the other Soundor packages, zod, rolldown, node:*)
      // resolve from the copy's own node_modules at run time.
      external: (id) =>
        !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
      plugins: [
        {
          name: 'copy-version',
          load(id) {
            return id.endsWith('package.json')
              ? {
                  code: JSON.stringify({ version: PLACEHOLDER }),
                  moduleType: 'json',
                }
              : null;
          },
        },
      ],
      logLevel: 'silent',
    });
    const { output } = await bundle.generate({ format: 'esm' });
    await bundle.close();
    bundles[key as Package] = output[0].code;
  }
}, 60_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Installs copies of `packages` at `version` into `dir/node_modules`. */
function install(
  dir: string,
  packages: Package[],
  version: string,
  { linkShared = true } = {},
): void {
  for (const key of packages) {
    const pkgDir = join(dir, 'node_modules', sources[key].name);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: sources[key].name,
        version,
        type: 'module',
        exports: './index.mjs',
      }),
    );
    writeFileSync(
      join(pkgDir, 'index.mjs'),
      bundles[key].replaceAll(PLACEHOLDER, version),
    );
  }
  if (!linkShared) return;
  for (const [name, target] of Object.entries(shared)) {
    const link = join(dir, 'node_modules', name);
    if (!existsSync(link)) symlinkSync(target, link, 'dir');
  }
}

interface Scenario {
  /** The CLI side: its @soundor/config and @soundor/core. */
  host: string;
  /** The runtime's own copies of the SDK, config and core. */
  runtimeCopies: string;
  /** What the runtime's package.json declares; undefined for none. */
  compatibility?: { config: string; core: string; schemas: number[] };
  /** The project's own @soundor/config, which its config is typed against. */
  project?: string;
  /** What the runtime's `gen` does. */
  gen: 'ok' | 'config-error' | 'env-error' | 'plain-error';
}

interface Outcome {
  stage: 'parse' | 'resolve' | 'gen' | 'done';
  compatibility?: string;
  warnings: string[];
  generated: boolean;
  error?: {
    name: string;
    code?: string;
    exitCode: number;
    isSoundorError: boolean;
    isConfigError: boolean;
    instanceOfHostError: boolean;
    text: string;
  };
}

let count = 0;

/** Lays out a project, its runtime and the host, and runs `gen` from the host. */
function run(scenario: Scenario): Outcome {
  const dir = join(root, `scenario-${count++}`);
  const host = join(dir, 'host');
  const project = join(dir, 'project');
  const runtime = join(project, 'node_modules', 'soundor-runtime-third');
  mkdirSync(host, { recursive: true });
  mkdirSync(runtime, { recursive: true });

  install(host, ['core', 'config'], scenario.host);
  install(runtime, ['core', 'config', 'runtime-sdk'], scenario.runtimeCopies);
  if (scenario.project !== undefined)
    install(project, ['config'], scenario.project, { linkShared: false });

  writeFileSync(
    join(runtime, 'package.json'),
    JSON.stringify({
      name: 'soundor-runtime-third',
      version: '2.1.0',
      type: 'module',
      exports: './index.mjs',
      ...(scenario.compatibility === undefined
        ? {}
        : { soundor: { compatibility: scenario.compatibility } }),
    }),
  );
  // A third-party runtime, as its author would write it with the SDK. An old
  // one, from before declarations, has no `package`.
  writeFileSync(
    join(runtime, 'index.mjs'),
    `
import { writeFileSync } from 'node:fs';
import { ConfigError, EnvError, defineRuntime } from '@soundor/runtime-sdk';
import manifest from './package.json' with { type: 'json' };

const noop = async () => {};
export const thirdRuntime = defineRuntime({
  id: 'third',
  ${
    scenario.compatibility === undefined
      ? ''
      : 'package: { name: manifest.name, version: manifest.version, compatibility: manifest.soundor.compatibility },'
  }
  init: noop,
  async gen(config, ctx) {
    switch (${JSON.stringify(scenario.gen)}) {
      case 'config-error':
        throw new ConfigError('validation', 'Invalid third runtime options.', [
          { path: 'runtimes[0].options.mode', message: "expected 'fast'" },
        ]);
      case 'env-error':
        throw new EnvError('third needs a toolchain that is not installed.');
      case 'plain-error':
        throw new TypeError('third crashed');
    }
    writeFileSync(${JSON.stringify(join(dir, 'generated'))}, config.plugin.id);
  },
  dev: noop,
  build: noop,
  doctor: async () => ({ checks: [] }),
});
`,
  );
  writeFileSync(
    join(project, 'soundor.config.ts'),
    `
import { defineSoundorConfig } from '@soundor/config';
import { thirdRuntime } from 'soundor-runtime-third';

export default defineSoundorConfig({
  plugin: { id: 'com.example.copies', name: 'Copies' },
  runtimes: [thirdRuntime({ mode: 'fast' })],
  parameters: [],
});
`,
  );
  // What the CLI does for `soundor gen`, with the host's copies.
  writeFileSync(
    join(host, 'run.mjs'),
    `
import {
  SoundorError, exitCodeFor, isConfigError, isSoundorError, parseConfig,
  resolveRuntime, runPhase,
} from '@soundor/config';
import { createCodegenSink } from '@soundor/core';

const warnings = [];
const logger = {
  debug() {}, info() {}, error() {}, pipe() {},
  warn: (message) => warnings.push(message),
  child: () => logger,
};
let stage = 'parse';
const outcome = { warnings };
try {
  const config = await parseConfig({ path: process.argv[2] });
  stage = 'resolve';
  const resolved = resolveRuntime(config, 'third');
  outcome.compatibility = resolved.compatibility;
  stage = 'gen';
  await runPhase(resolved, 'gen', config, {
    paths: { root: '/p', config: '/p/c', dist: '/p/d', gen: '/p/g', cache: '/p/x', state: '/p/s' },
    logger, fs: {}, codegen: createCodegenSink(), env: {},
  });
  stage = 'done';
} catch (error) {
  outcome.error = {
    name: error.name,
    code: error.code,
    exitCode: exitCodeFor(error),
    isSoundorError: isSoundorError(error),
    isConfigError: isConfigError(error),
    instanceOfHostError: error instanceof SoundorError,
    text: typeof error.format === 'function' ? error.format() : error.message,
  };
}
outcome.stage = stage;
console.log(JSON.stringify(outcome));
`,
  );

  const child = spawnSync(
    process.execPath,
    [join(host, 'run.mjs'), join(project, 'soundor.config.ts')],
    { encoding: 'utf8' },
  );
  if (child.status !== 0)
    throw new Error(`scenario failed to run:\n${child.stderr}`);
  return {
    ...(JSON.parse(child.stdout) as Omit<Outcome, 'generated'>),
    generated: existsSync(join(dir, 'generated')),
  };
}

/** Ranges that cover exactly this workspace's versions. */
const current = {
  config: `^${CONFIG_VERSION}`,
  core: `^${CORE_VERSION}`,
  schemas: [CONFIG_SCHEMA_VERSION],
};

/** The next patch of `version`: a compatible copy that is not the same. */
function nextPatch(version: string): string {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch! + 1}`;
}

describe('separate copies of the Soundor packages', () => {
  it('run a compatible runtime registered with another copy of the SDK', () => {
    const outcome = run({
      host: CONFIG_VERSION,
      runtimeCopies: CONFIG_VERSION,
      compatibility: current,
      project: CONFIG_VERSION,
      gen: 'ok',
    });
    expect(outcome).toMatchObject({
      stage: 'done',
      compatibility: 'compatible',
      warnings: [],
      generated: true,
    });
  });

  it('recognize errors thrown from another copy, of the same version', () => {
    const configError = run({
      host: CONFIG_VERSION,
      runtimeCopies: CONFIG_VERSION,
      compatibility: current,
      gen: 'config-error',
    });
    expect(configError.stage).toBe('gen');
    expect(configError.error).toMatchObject({
      // Passed through as the runtime threw it, not wrapped as a RuntimeError.
      name: 'ConfigError',
      code: 'CONFIG',
      exitCode: 2,
      isSoundorError: true,
      isConfigError: true,
      // The copies are separate: instanceof cannot tell.
      instanceOfHostError: false,
    });
    expect(configError.error?.text).toContain(
      "runtimes[0].options.mode: expected 'fast'",
    );

    const envError = run({
      host: CONFIG_VERSION,
      runtimeCopies: CONFIG_VERSION,
      compatibility: current,
      gen: 'env-error',
    });
    expect(envError.error).toMatchObject({
      name: 'EnvError',
      code: 'ENV',
      exitCode: 3,
      isSoundorError: true,
      isConfigError: false,
    });

    // Anything else is the runtime failing, wrapped by the host.
    const crash = run({
      host: CONFIG_VERSION,
      runtimeCopies: CONFIG_VERSION,
      compatibility: current,
      gen: 'plain-error',
    });
    expect(crash.error).toMatchObject({
      name: 'RuntimeError',
      code: 'RUNTIME',
      exitCode: 5,
      instanceOfHostError: true,
    });
  });

  it('work across compatible versions', () => {
    const outcome = run({
      host: CONFIG_VERSION,
      runtimeCopies: nextPatch(CONFIG_VERSION),
      compatibility: current,
      project: nextPatch(CONFIG_VERSION),
      gen: 'env-error',
    });
    expect(outcome.compatibility).toBe('compatible');
    expect(outcome.error).toMatchObject({ code: 'ENV', exitCode: 3 });
  });

  it('refuse a runtime for other versions before it generates anything', () => {
    const outcome = run({
      host: '0.30.0',
      runtimeCopies: '0.29.0',
      compatibility: {
        config: '>=0.29.0 <0.30.0',
        core: '>=0.29.0 <0.30.0',
        schemas: [CONFIG_SCHEMA_VERSION],
      },
      project: '0.30.0',
      gen: 'ok',
    });
    expect(outcome.stage).toBe('resolve');
    expect(outcome.generated).toBe(false);
    expect(outcome.error).toMatchObject({
      name: 'RuntimeCompatibilityError',
      code: 'INCOMPATIBLE_RUNTIME',
      exitCode: 4,
    });
    expect(outcome.error?.text).toBe(
      [
        "Runtime 'third' (soundor-runtime-third@2.1.0) does not support this project's Soundor version.",
        '  @soundor/config 0.30.0: the runtime supports >=0.29.0 <0.30.0',
        '  @soundor/core 0.30.0: the runtime supports >=0.29.0 <0.30.0',
        'Upgrade soundor-runtime-third to a version that supports @soundor/config 0.30.0, or use soundor and @soundor/config at a version it supports.',
      ].join('\n'),
    );
  });

  it('refuse a malformed declaration', () => {
    const outcome = run({
      host: CONFIG_VERSION,
      runtimeCopies: CONFIG_VERSION,
      compatibility: { config: 'latest', core: current.core, schemas: [] },
      gen: 'ok',
    });
    expect(outcome.stage).toBe('resolve');
    expect(outcome.generated).toBe(false);
    expect(outcome.error).toMatchObject({
      code: 'INVALID_RUNTIME',
      exitCode: 4,
    });
  });

  it('run a runtime from before declarations, with a warning', () => {
    const outcome = run({
      host: CONFIG_VERSION,
      runtimeCopies: CONFIG_VERSION,
      gen: 'ok',
    });
    expect(outcome).toMatchObject({
      stage: 'done',
      compatibility: 'undeclared',
      generated: true,
    });
    expect(outcome.warnings).toEqual([
      expect.stringContaining("Runtime 'third' declares no compatibility"),
    ]);
  });

  it("refuse a project whose @soundor/config is of another line than the host's", () => {
    const outcome = run({
      host: '0.30.0',
      runtimeCopies: '0.30.0',
      compatibility: {
        config: '^0.30.0',
        core: '^0.30.0',
        schemas: [CONFIG_SCHEMA_VERSION],
      },
      project: '0.29.1',
      gen: 'ok',
    });
    expect(outcome.stage).toBe('parse');
    expect(outcome.generated).toBe(false);
    expect(outcome.error).toMatchObject({
      name: 'ConfigError',
      exitCode: 2,
      isConfigError: true,
    });
    expect(outcome.error?.text).toContain(
      "This project's @soundor/config is 0.29.1, but soundor reads configs with @soundor/config 0.30.0.",
    );
  });

  it('install each copy from its own tree', () => {
    // A sanity check of the fixture itself: the host and the runtime load
    // different files, with the versions written into them.
    const dir = join(root, `scenario-${count - 1}`);
    const hostCore = readFileSync(
      join(dir, 'host/node_modules/@soundor/core/index.mjs'),
      'utf8',
    );
    expect(hostCore).toContain('"0.30.0"');
    expect(hostCore).not.toContain(PLACEHOLDER);
  });
});
