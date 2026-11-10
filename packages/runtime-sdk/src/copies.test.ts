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

import {
  CONFIG_VERSION,
  MIN_RUNTIME_API_VERSION,
  RUNTIME_API_VERSION,
} from './index';

const PLACEHOLDER = '0.0.0-soundor-copy';
/** RUNTIME_API_VERSION and MIN_RUNTIME_API_VERSION, set per copy. */
const API_PLACEHOLDER = '7340021';
const MIN_PLACEHOLDER = '7340022';

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Where `name` is installed for the package at `from`, as Node finds it. */
function installed(from: string, name: string): string {
  return realpathSync(join(from, 'node_modules', name));
}
const configRoot = installed(sdkRoot, '@soundor/config');
const coreRoot = installed(configRoot, '@soundor/core');
/**
 * Packages the copies import, linked into every tree: third-party ones, and
 * `@soundor/expression`, whose plain data no copy recognizes by identity.
 */
const shared = {
  zod: installed(configRoot, 'zod'),
  rolldown: installed(configRoot, 'rolldown'),
  '@soundor/expression': installed(configRoot, '@soundor/expression'),
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
          name: 'copy-api-version',
          transform(code, id) {
            if (!id.endsWith('/config/src/version.ts')) return null;
            const replaced = code
              .replace(
                /RUNTIME_API_VERSION = \d+;/,
                `RUNTIME_API_VERSION = ${API_PLACEHOLDER};`,
              )
              .replace(
                /MIN_RUNTIME_API_VERSION = \d+;/,
                `MIN_RUNTIME_API_VERSION = ${MIN_PLACEHOLDER};`,
              );
            if (
              !replaced.includes(API_PLACEHOLDER) ||
              !replaced.includes(MIN_PLACEHOLDER)
            )
              throw new Error(`no runtime API versions to replace in ${id}`);
            return replaced;
          },
        },
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

/** A copy of the Soundor packages: their version, and runtime API versions. */
interface Copy {
  version: string;
  /** RUNTIME_API_VERSION, and MIN_RUNTIME_API_VERSION, in its config. */
  api?: number;
  min?: number;
}

/** Installs copies of `packages` as `copy` into `dir/node_modules`. */
function install(
  dir: string,
  packages: Package[],
  copy: Copy,
  { linkShared = true } = {},
): void {
  for (const key of packages) {
    const pkgDir = join(dir, 'node_modules', sources[key].name);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: sources[key].name,
        version: copy.version,
        type: 'module',
        exports: './index.mjs',
      }),
    );
    const code = bundles[key]
      .replaceAll(PLACEHOLDER, copy.version)
      .replaceAll(API_PLACEHOLDER, String(copy.api ?? RUNTIME_API_VERSION))
      .replaceAll(MIN_PLACEHOLDER, String(copy.min ?? MIN_RUNTIME_API_VERSION));
    writeFileSync(join(pkgDir, 'index.mjs'), code);
  }
  if (!linkShared) return;
  for (const [name, target] of Object.entries(shared)) {
    const link = join(dir, 'node_modules', name);
    mkdirSync(dirname(link), { recursive: true });
    if (!existsSync(link)) symlinkSync(target, link, 'dir');
  }
}

interface Scenario {
  /** The CLI side: its @soundor/config and @soundor/core. */
  host: Copy;
  /** The runtime's own copies of the SDK, config and core. */
  runtimeCopies: Copy;
  /** A runtime from before API versions: no defineRuntime, no apiVersion. */
  legacy?: boolean;
  /** The project's own @soundor/config, which its config is typed against. */
  project?: string;
  /** What the runtime's `gen` does. */
  gen: 'ok' | 'config-error' | 'env-error' | 'plain-error';
}

interface Outcome {
  stage: 'parse' | 'resolve' | 'gen' | 'done';
  apiVersion?: number;
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
    install(
      project,
      ['config'],
      { version: scenario.project },
      { linkShared: false },
    );

  writeFileSync(
    join(runtime, 'package.json'),
    JSON.stringify({
      name: 'soundor-runtime-third',
      version: '2.1.0',
      type: 'module',
      exports: './index.mjs',
    }),
  );
  // A third-party runtime, as its author would write it with the SDK; an old
  // one, from before API versions, is a plain object.
  writeFileSync(
    join(runtime, 'index.mjs'),
    `
import { writeFileSync } from 'node:fs';
import { ConfigError, EnvError, defineRuntime } from '@soundor/runtime-sdk';

const noop = async () => {};
const definition = {
  id: 'third',
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
};
export const thirdRuntime = ${
      scenario.legacy === true
        ? '(options = {}) => ({ id: definition.id, options, runtime: definition })'
        : 'defineRuntime(definition)'
    };
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
  parameters: {},
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
  outcome.apiVersion = resolved.apiVersion;
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

/** The next patch of `version`: a compatible copy that is not the same. */
function nextPatch(version: string): string {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch! + 1}`;
}

const workspace: Copy = { version: CONFIG_VERSION };

describe('separate copies of the Soundor packages', () => {
  it('run a runtime registered with another copy of the SDK', () => {
    const outcome = run({
      host: workspace,
      runtimeCopies: workspace,
      project: CONFIG_VERSION,
      gen: 'ok',
    });
    expect(outcome).toMatchObject({
      stage: 'done',
      apiVersion: RUNTIME_API_VERSION,
      warnings: [],
      generated: true,
    });
  });

  it('recognize errors thrown from another copy, of the same version', () => {
    const configError = run({
      host: workspace,
      runtimeCopies: workspace,
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
      host: workspace,
      runtimeCopies: workspace,
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
      host: workspace,
      runtimeCopies: workspace,
      gen: 'plain-error',
    });
    expect(crash.error).toMatchObject({
      name: 'RuntimeError',
      code: 'RUNTIME',
      exitCode: 5,
      instanceOfHostError: true,
    });
  });

  it('work across package versions of one runtime API version', () => {
    const outcome = run({
      host: { version: '0.30.0', api: 3 },
      runtimeCopies: { version: '0.27.4', api: 3 },
      gen: 'env-error',
    });
    expect(outcome.apiVersion).toBe(3);
    expect(outcome.error).toMatchObject({ code: 'ENV', exitCode: 3 });
  });

  it('run an older runtime the host still supports', () => {
    const outcome = run({
      host: { version: '0.30.0', api: 4, min: 2 },
      runtimeCopies: { version: '0.25.0', api: 2 },
      gen: 'ok',
    });
    expect(outcome).toMatchObject({ stage: 'done', apiVersion: 2 });
  });

  it('refuse a runtime newer than the host before it generates anything', () => {
    const outcome = run({
      host: { version: '0.30.0', api: 3 },
      runtimeCopies: { version: '0.31.0', api: 4 },
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
        "Runtime 'third' implements runtime API 4, newer than this soundor (@soundor/config 0.30.0), which runs runtime API 1 to 3.",
        'Upgrade soundor and @soundor/config to a release the runtime is made for, or use an older release of the runtime.',
      ].join('\n'),
    );
  });

  it('refuse a runtime older than the host still runs', () => {
    const outcome = run({
      host: { version: '0.30.0', api: 4, min: 3 },
      runtimeCopies: { version: '0.25.0', api: 2 },
      gen: 'ok',
    });
    expect(outcome.stage).toBe('resolve');
    expect(outcome.generated).toBe(false);
    expect(outcome.error?.text).toContain(
      "Runtime 'third' implements runtime API 2, which this soundor (@soundor/config 0.30.0) no longer runs: it runs runtime API 3 to 4.",
    );
  });

  it('take a runtime from before API versions for version 1', () => {
    const outcome = run({
      host: workspace,
      runtimeCopies: workspace,
      legacy: true,
      gen: 'ok',
    });
    expect(outcome).toMatchObject({ stage: 'done', apiVersion: 1 });
  });

  it("refuse a project whose @soundor/config is of another line than the host's", () => {
    const outcome = run({
      host: { version: '0.30.0' },
      runtimeCopies: { version: '0.30.0' },
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

  it('keep a compatible patch of the project @soundor/config', () => {
    const outcome = run({
      host: workspace,
      runtimeCopies: workspace,
      project: nextPatch(CONFIG_VERSION),
      gen: 'ok',
    });
    expect(outcome.stage).toBe('done');
  });
});
