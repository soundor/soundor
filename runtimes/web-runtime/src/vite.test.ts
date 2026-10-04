import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveConfig, type Plugin } from 'vite';
import { describe, expect, it } from 'vitest';

import { soundorWebPlugin } from './plugin';
import { defineWebConfig } from './vite';

describe('defineWebConfig', () => {
  it('keeps the project settings and plugins', () => {
    const own: Plugin = { name: 'own' };
    const config = defineWebConfig({ plugins: [own], define: { X: '1' } });
    expect(config.define).toEqual({ X: '1' });
    expect(config.plugins?.[0]).toBe(own);
  });

  it('fails outside the Soundor lifecycle', async () => {
    await expect(
      resolveConfig({ configFile: false, ...defineWebConfig() }, 'serve'),
    ).rejects.toThrow('soundor dev web');
  });

  it('cannot move the output or base the lifecycle sets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'web-runtime-'));
    const resolved = await resolveConfig(
      {
        configFile: false,
        ...defineWebConfig({
          base: '/absolute/',
          build: { outDir: 'elsewhere' },
        }),
        plugins: [
          ...(defineWebConfig().plugins ?? []),
          soundorWebPlugin({
            hostDir: root,
            genDir: join(root, 'gen'),
            outDir: join(root, 'dist'),
          }),
        ],
      },
      'build',
    );
    expect(resolved.root).toBe(root);
    expect(resolved.base).toBe('./');
    expect(resolved.build.outDir).toBe(join(root, 'dist'));
    expect(resolved.build.emptyOutDir).toBe(true);
    expect(resolved.optimizeDeps.exclude).toContain(
      '@soundor/web-runtime/client',
    );
  });
});
