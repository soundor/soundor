import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exitCodeFor } from '@soundor/core';
import { afterAll, describe, expect, it } from 'vitest';

import {
  CONFIG_FEATURES,
  HOST_RUNTIME_API,
  checkRuntimeCompatibility,
  type ConfigFeature,
  type HostRuntimeApi,
} from '../compatibility';
import { isConfigError } from '../errors';
import {
  checkProjectConfigVersion,
  projectConfigVersion,
  sameReleaseLine,
} from '../project';
import { resolveRuntime } from '../registry';
import type { Runtime } from '../runtime';
import { validateConfig } from '../schema';
import type { ResolvedSoundorConfig } from '../types';
import {
  CONFIG_VERSION,
  MIN_RUNTIME_API_VERSION,
  RUNTIME_API_VERSION,
} from '../version';

const HOST: HostRuntimeApi = { min: 2, current: 4, configVersion: '0.9.0' };

function runtime(apiVersion?: unknown): Runtime {
  const noop = async (): Promise<void> => {};
  return {
    id: 'third',
    ...(apiVersion === undefined ? {} : { apiVersion: apiVersion as number }),
    init: noop,
    gen: noop,
    dev: noop,
    build: noop,
    doctor: async () => ({ checks: [] }),
  };
}

function project(
  parameters: Record<string, unknown> = {},
  entry: Runtime = runtime(),
): ResolvedSoundorConfig {
  return {
    ...validateConfig({
      plugin: { id: 'com.example.test', name: 'Test' },
      runtimes: [],
      parameters,
    }),
    runtimes: [{ id: entry.id, options: {}, runtime: entry }],
  };
}

/** A setting added in runtime API 4: parameters with a `unit` of 'Hz'. */
const HERTZ: ConfigFeature = {
  since: 4,
  name: 'parameters in hertz',
  find: (config) =>
    config.parameters.flatMap((parameter) =>
      'unit' in parameter && parameter.unit === 'Hz'
        ? [`parameters.${parameter.id}.unit`]
        : [],
    ),
};

const cutoff = {
  type: 'float32',
  label: 'Cutoff',
  min: 20,
  max: 20000,
  default: 1000,
  unit: 'Hz',
} as const;

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
  it('runs runtimes of every version the host supports', () => {
    for (const version of [2, 3, 4])
      expect(
        checkRuntimeCompatibility(runtime(version), project(), { host: HOST }),
      ).toBe(version);
  });

  it('takes a runtime from before API versions for version 1', () => {
    expect(
      checkRuntimeCompatibility(runtime(), project(), {
        host: { ...HOST, min: 1 },
      }),
    ).toBe(1);
    expect(() =>
      checkRuntimeCompatibility(runtime(), project(), { host: HOST }),
    ).toThrow(/implements runtime API 1, which this soundor/);
  });

  it('refuses a runtime newer than the host', () => {
    const error = thrown(() =>
      checkRuntimeCompatibility(runtime(5), project(), { host: HOST }),
    ) as { code: string; format(): string };
    expect(error.code).toBe('INCOMPATIBLE_RUNTIME');
    expect(exitCodeFor(error)).toBe(4);
    expect(error.format()).toBe(
      [
        "Runtime 'third' implements runtime API 5, newer than this soundor (@soundor/config 0.9.0), which runs runtime API 2 to 4.",
        'Upgrade soundor and @soundor/config to a release the runtime is made for, or use an older release of the runtime.',
      ].join('\n'),
    );
  });

  it('refuses a runtime older than the host still runs', () => {
    const error = thrown(() =>
      checkRuntimeCompatibility(runtime(1), project(), { host: HOST }),
    ) as { format(): string };
    expect(error.format()).toBe(
      [
        "Runtime 'third' implements runtime API 1, which this soundor (@soundor/config 0.9.0) no longer runs: it runs runtime API 2 to 4.",
        'Upgrade the runtime to a release made for runtime API 4, or use an older soundor and @soundor/config.',
      ].join('\n'),
    );
  });

  it('refuses a config using what the runtime API version lacks, by path', () => {
    const options = { host: HOST, features: [HERTZ] };
    const uses = project({
      low: cutoff,
      q: { ...cutoff, unit: 'dB' },
      high: cutoff,
    });
    expect(checkRuntimeCompatibility(runtime(4), uses, options)).toBe(4);
    expect(checkRuntimeCompatibility(runtime(3), project(), options)).toBe(3);
    const error = thrown(() =>
      checkRuntimeCompatibility(runtime(3), uses, options),
    ) as { code: string; format(): string };
    expect(error.code).toBe('INCOMPATIBLE_RUNTIME');
    expect(error.format()).toBe(
      [
        "Runtime 'third' implements runtime API 3, which does not have what this config uses:",
        '  parameters.low.unit: parameters in hertz, from runtime API 4',
        '  parameters.high.unit: parameters in hertz, from runtime API 4',
        'Upgrade the runtime to a release that supports them, or remove them from the config.',
      ].join('\n'),
    );
  });

  it('refuses an unreadable API version, never guessing', () => {
    for (const version of [0, 1.5, '2', null])
      expect(
        (
          thrown(() =>
            checkRuntimeCompatibility(runtime(version), project(), {
              host: HOST,
            }),
          ) as { code: string }
        ).code,
      ).toBe('INVALID_RUNTIME');
  });

  it("checks against this copy's versions and features by default", () => {
    expect(HOST_RUNTIME_API).toEqual({
      min: MIN_RUNTIME_API_VERSION,
      current: RUNTIME_API_VERSION,
      configVersion: CONFIG_VERSION,
    });
    expect(MIN_RUNTIME_API_VERSION).toBeLessThanOrEqual(RUNTIME_API_VERSION);
    for (const feature of CONFIG_FEATURES) {
      expect(feature.since).toBeGreaterThan(1);
      expect(feature.since).toBeLessThanOrEqual(RUNTIME_API_VERSION);
    }
  });
});

describe('resolveRuntime', () => {
  it('refuses an incompatible runtime before any phase', () => {
    const calls: string[] = [];
    const newer = {
      ...runtime(RUNTIME_API_VERSION + 1),
      gen: async () => void calls.push('gen'),
    };
    expect(() => resolveRuntime(project({}, newer), 'third')).toThrow(
      /newer than this soundor/,
    );
    expect(calls).toEqual([]);
  });

  it('resolves a compatible runtime with its API version', () => {
    expect(
      resolveRuntime(project({}, runtime(RUNTIME_API_VERSION)), 'third')
        .apiVersion,
    ).toBe(RUNTIME_API_VERSION);
  });
});

describe('sameReleaseLine', () => {
  it('is the same minor before 1.0 and the same major after', () => {
    expect(sameReleaseLine('0.16.0', '0.16.4')).toBe(true);
    expect(sameReleaseLine('0.16.0', '0.17.0')).toBe(false);
    expect(sameReleaseLine('0.16.0-next.1', '0.16.2')).toBe(true);
    expect(sameReleaseLine('1.2.0', '1.9.1')).toBe(true);
    expect(sameReleaseLine('1.2.0', '2.0.0')).toBe(false);
    expect(sameReleaseLine('0.16', '0.16.0')).toBe(false);
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
        parameters: {
          gain: {
            type: 'float32',
            label: 'Gain',
            min: 0,
            max: 1,
            default: 0.5,
            smoothing: 0.01,
          },
        },
        editor: { width: 400, height: 300, scale: 2 },
        presets: [],
      }),
    ) as { issues: { path: string; message: string }[] };
    expect(error.issues.map((issue) => issue.path).sort()).toEqual([
      'editor.scale',
      'parameters.gain.smoothing',
      'plugin.vendor',
      'presets',
    ]);
    expect(
      error.issues.find((issue) => issue.path === 'parameters.gain.smoothing')
        ?.message,
    ).toBe(
      `unknown property 'smoothing' in @soundor/config ${CONFIG_VERSION}; check its spelling, or upgrade soundor and @soundor/config together if it is from a newer release`,
    );
  });
});
