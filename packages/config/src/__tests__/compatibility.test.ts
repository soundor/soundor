import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CORE_VERSION,
  createCodegenSink,
  exitCodeFor,
  type FileSystemHost,
  type Logger,
} from '@soundor/core';
import { afterAll, describe, expect, it } from 'vitest';

import {
  HOST_VERSIONS,
  checkRuntimeCompatibility,
  type HostVersions,
} from '../compatibility';
import { isConfigError } from '../errors';
import { checkProjectConfigVersion, projectConfigVersion } from '../project';
import { resolveRuntime, runPhase } from '../registry';
import type { Runtime, RuntimePackage } from '../runtime';
import { validateConfig } from '../schema';
import type { SoundorConfig } from '../types';
import { CONFIG_SCHEMA_VERSION, CONFIG_VERSION } from '../version';

const HOST: HostVersions = { config: '0.9.0', core: '0.9.0', schema: 3 };

function runtime(pkg?: unknown): Runtime {
  const noop = async (): Promise<void> => {};
  return {
    id: 'third',
    ...(pkg === undefined ? {} : { package: pkg as RuntimePackage }),
    init: noop,
    gen: noop,
    dev: noop,
    build: noop,
    doctor: async () => ({ checks: [] }),
  };
}

function declaring(
  compatibility: Partial<RuntimePackage['compatibility']>,
): Runtime {
  return runtime({
    name: 'soundor-runtime-third',
    version: '2.1.0',
    compatibility: {
      config: '>=0.9.0 <0.10.0',
      core: '>=0.9.0 <0.10.0',
      schemas: [3],
      ...compatibility,
    },
  });
}

/** What `fn` throws. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('checkRuntimeCompatibility', () => {
  it('accepts a runtime whose ranges include the host', () => {
    expect(checkRuntimeCompatibility(declaring({}), HOST)).toBe('compatible');
    expect(
      checkRuntimeCompatibility(
        declaring({
          config: '^0.8.0 || ^0.9.0',
          schemas: [2, 3],
        }),
        HOST,
      ),
    ).toBe('compatible');
  });

  it('refuses a runtime for another config, naming every version', () => {
    const error = thrown(() =>
      checkRuntimeCompatibility(
        declaring({ config: '>=0.8.0 <0.9.0', core: '^0.8.0' }),
        HOST,
      ),
    ) as { code: string; format(): string };
    expect(error.code).toBe('INCOMPATIBLE_RUNTIME');
    expect(exitCodeFor(error)).toBe(4);
    expect(error.format()).toBe(
      [
        "Runtime 'third' (soundor-runtime-third@2.1.0) does not support this project's Soundor version.",
        '  @soundor/config 0.9.0: the runtime supports >=0.8.0 <0.9.0',
        '  @soundor/core 0.9.0: the runtime supports ^0.8.0',
        'Upgrade soundor-runtime-third to a version that supports @soundor/config 0.9.0, or use soundor and @soundor/config at a version it supports.',
      ].join('\n'),
    );
  });

  it('refuses a runtime without the host config schema', () => {
    const error = thrown(() =>
      checkRuntimeCompatibility(declaring({ schemas: [1, 2] }), HOST),
    ) as { format(): string };
    expect(error.format()).toContain(
      'config schema 3: the runtime supports 1, 2',
    );
  });

  it('refuses a malformed declaration, never guessing', () => {
    const error = thrown(() =>
      checkRuntimeCompatibility(
        runtime({
          name: 'x',
          version: 'latest',
          compatibility: { config: '0.9', core: 9, schemas: [] },
        }),
        HOST,
      ),
    ) as { code: string; issues: { path: string }[] };
    expect(error.code).toBe('INVALID_RUNTIME');
    expect(error.issues.map((issue) => issue.path)).toEqual([
      'package.version',
      'package.compatibility.config',
      'package.compatibility.core',
      'package.compatibility.schemas',
    ]);
    expect(
      (
        thrown(() => checkRuntimeCompatibility(runtime(null), HOST)) as {
          code: string;
        }
      ).code,
    ).toBe('INVALID_RUNTIME');
    expect(
      (
        thrown(() =>
          checkRuntimeCompatibility(
            runtime({ name: 'x', version: '1.0.0' }),
            HOST,
          ),
        ) as { issues: { path: string }[] }
      ).issues,
    ).toEqual([
      {
        path: 'package.compatibility',
        message: 'expected { config, core, schemas }',
      },
    ]);
  });

  it('reports a runtime that declares nothing as undeclared', () => {
    expect(checkRuntimeCompatibility(runtime(), HOST)).toBe('undeclared');
  });

  it('checks against this copy by default', () => {
    expect(HOST_VERSIONS).toEqual({
      config: CONFIG_VERSION,
      core: CORE_VERSION,
      schema: CONFIG_SCHEMA_VERSION,
    });
  });
});

describe('resolveRuntime and runPhase', () => {
  const current = {
    config: `^${CONFIG_VERSION}`,
    core: `^${CORE_VERSION}`,
    schemas: [CONFIG_SCHEMA_VERSION],
  };
  function project(entry: Runtime): SoundorConfig {
    return {
      plugin: { id: 'com.example.test', name: 'Test' },
      runtimes: [{ id: entry.id, options: {}, runtime: entry }],
      parameters: [],
    };
  }
  function input(warnings: string[]) {
    const logger: Logger = {
      debug() {},
      info() {},
      warn: (message) => void warnings.push(message),
      error() {},
      pipe() {},
      child: () => logger,
    };
    return {
      paths: {
        root: '/p',
        config: '/p/soundor.config.ts',
        dist: '/p/d',
        gen: '/p/g',
        cache: '/p/c',
        state: '/p/s',
      },
      logger,
      fs: {} as FileSystemHost,
      codegen: createCodegenSink(),
      env: {},
    };
  }

  it('refuses an incompatible runtime before any phase', () => {
    const calls: string[] = [];
    const incompatible = {
      ...declaring({ config: '>=0.0.1 <0.0.2' }),
      gen: async () => void calls.push('gen'),
    };
    expect(() => resolveRuntime(project(incompatible), 'third')).toThrow(
      /does not support this project's Soundor version/,
    );
    expect(calls).toEqual([]);
  });

  it('runs a compatible runtime without a warning', async () => {
    const warnings: string[] = [];
    const entry = declaring(current);
    const resolved = resolveRuntime(project(entry), 'third');
    expect(resolved.compatibility).toBe('compatible');
    await runPhase(resolved, 'gen', project(entry), input(warnings));
    expect(warnings).toEqual([]);
  });

  it('runs an undeclared runtime with a warning', async () => {
    const warnings: string[] = [];
    const entry = runtime();
    const resolved = resolveRuntime(project(entry), 'third');
    expect(resolved.compatibility).toBe('undeclared');
    await runPhase(resolved, 'gen', project(entry), input(warnings));
    expect(warnings).toEqual([
      expect.stringContaining("Runtime 'third' declares no compatibility"),
    ]);
  });
});

describe('the project @soundor/config', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  function projectWith(version: string | undefined): string {
    const root = mkdtempSync(join(tmpdir(), 'soundor-project-'));
    dirs.push(root);
    const nested = join(root, 'apps', 'plugin');
    mkdirSync(nested, { recursive: true });
    if (version !== undefined) {
      const dir = join(root, 'node_modules', '@soundor', 'config');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: '@soundor/config', version }),
      );
    }
    return nested;
  }

  it('is found as Node would, from the config directory up', () => {
    expect(projectConfigVersion(projectWith('0.9.2'))).toBe('0.9.2');
    expect(projectConfigVersion(projectWith(undefined))).toBeUndefined();
  });

  it('must be of the host release line', () => {
    expect(() =>
      checkProjectConfigVersion(projectWith('0.9.4'), '0.9.0'),
    ).not.toThrow();
    expect(() =>
      checkProjectConfigVersion(projectWith(undefined), '0.9.0'),
    ).not.toThrow();
    const error = thrown(() =>
      checkProjectConfigVersion(projectWith('0.10.0'), '0.9.0'),
    );
    expect(isConfigError(error)).toBe(true);
    expect(error).toMatchObject({
      kind: 'compatibility',
      message:
        "This project's @soundor/config is 0.10.0, but soundor reads configs with @soundor/config 0.9.0.",
    });
    expect(exitCodeFor(error)).toBe(2);
  });
});

describe('unknown config properties', () => {
  it('are errors, never dropped', () => {
    const error = thrown(() =>
      validateConfig({
        plugin: { id: 'com.example.test', name: 'Test', vendor: 'Acme' },
        runtimes: [],
        parameters: [
          {
            type: 'float',
            id: 'gain',
            label: 'Gain',
            min: 0,
            max: 1,
            default: 0.5,
            mapping: { type: 'symmetricPower', exponent: 2 },
          },
        ],
        editor: { width: 400, height: 300, scale: 2 },
        presets: [],
      }),
    ) as { issues: { path: string; message: string }[] };
    expect(error.issues.map((issue) => issue.path).sort()).toEqual([
      'editor.scale',
      'parameters[0].mapping',
      'plugin.vendor',
      'presets',
    ]);
    expect(
      error.issues.find((issue) => issue.path === 'parameters[0].mapping')
        ?.message,
    ).toBe(
      `unknown property 'mapping' in @soundor/config ${CONFIG_VERSION} (config schema ${CONFIG_SCHEMA_VERSION}); check its spelling, or upgrade soundor and @soundor/config together if it is from a newer release`,
    );
  });
});
