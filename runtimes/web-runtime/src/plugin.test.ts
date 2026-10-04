import { join } from 'node:path';

import type { Plugin } from 'vite';
import { describe, expect, it } from 'vitest';

import { soundorModules } from './plugin';
import { SOURCE_CLIENT_DIR } from './testing';

function resolver(): (id: string) => unknown {
  const plugin = soundorModules({
    genDir: '/project/.soundor/generated/runtimes/web',
    clientDir: SOURCE_CLIENT_DIR,
  }) as Plugin & { resolveId: (this: unknown, id: string) => unknown };
  const context = {
    error(message: string): never {
      throw new Error(message);
    },
  };
  return (id) => plugin.resolveId.call(context, id);
}

describe('soundorModules', () => {
  it('resolves the runtime modules to the package browser code', () => {
    const resolve = resolver();
    expect(resolve('soundor:parameters')).toBe(
      join(SOURCE_CLIENT_DIR, 'modules/parameters.ts'),
    );
    expect(resolve('soundor:host')).toBe(
      join(SOURCE_CLIENT_DIR, 'modules/host.ts'),
    );
    expect(resolve('@soundor/web-runtime/client')).toBe(
      join(SOURCE_CLIENT_DIR, 'index.ts'),
    );
    expect(resolve('soundor:internal/manifest')).toBe(
      '/project/.soundor/generated/runtimes/web/manifest.json',
    );
  });

  it('leaves other modules alone and rejects unknown soundor: ones', () => {
    const resolve = resolver();
    expect(resolve('react')).toBeNull();
    expect(resolve('./main.ts')).toBeNull();
    expect(() => resolve('soundor:nope')).toThrow(
      "Unknown Soundor module 'soundor:nope'",
    );
  });
});
