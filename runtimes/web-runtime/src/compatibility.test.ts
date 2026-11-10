import { readFileSync } from 'node:fs';

import { checkRuntimeCompatibility, HOST_VERSIONS } from '@soundor/runtime-sdk';
import { describe, expect, it } from 'vitest';

import { webRuntime } from './index';

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { name: string; version: string; soundor: { compatibility: unknown } };

describe('compatibility', () => {
  it('declares its package.json name, version and compatibility', () => {
    expect(webRuntime.runtime.package).toEqual({
      name: manifest.name,
      version: manifest.version,
      compatibility: manifest.soundor.compatibility,
    });
  });

  // The versions these tests run with: a release that changes them must
  // check the runtime against them and update its declaration.
  it('supports the @soundor/config, core and config schema it is tested with', () => {
    expect(checkRuntimeCompatibility(webRuntime.runtime, HOST_VERSIONS)).toBe(
      'compatible',
    );
  });
});
