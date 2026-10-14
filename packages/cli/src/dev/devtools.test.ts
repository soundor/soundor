import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Runtime } from '@soundor/config';
import { expect, it, vi } from 'vitest';

import { resolveDevToolsSettings } from './devtools';

it('discovers optional support without invoking runtime methods', async () => {
  const method = vi.fn(async () => {});
  const runtime: Runtime = {
    id: 'third-party',
    init: method,
    gen: method,
    dev: method,
    build: method,
    doctor: async () => ({ checks: [] }),
  };
  const dir = await mkdtemp(join(tmpdir(), 'soundor-devtools-'));
  const path = join(dir, 'settings.json');
  try {
    await writeFile(path, 'invalid');
    expect(await resolveDevToolsSettings(runtime, { path })).toBeUndefined();
    const supported = {
      ...runtime,
      capabilities: { devtools: { inspector: true } },
    };
    await expect(resolveDevToolsSettings(supported, { path })).rejects.toThrow(
      'Invalid JSON',
    );
    await writeFile(path, '{"devtools":{"enabled":false}}');
    expect(await resolveDevToolsSettings(supported, { path })).toBeUndefined();
    await writeFile(path, '{"devtools":{"port":4545}}');
    expect(await resolveDevToolsSettings(supported, { path })).toEqual({
      enabled: true,
      port: 4545,
      open: false,
      portSource: 'config',
    });
    expect(method).not.toHaveBeenCalled();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
