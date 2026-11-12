import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exitCodeFor } from '@soundor/core';
import { afterAll, describe, expect, it } from 'vitest';

import { isConfigError } from '../errors';
import {
  checkProjectConfigVersion,
  projectConfigVersion,
  sameReleaseLine,
} from '../project';
import { validateConfig } from '../schema';
import { CONFIG_VERSION } from '../version';

/** What `fn` throws. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

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
