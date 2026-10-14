import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { loadUserSettings, parseUserSettings, userConfigPath } from './user';

it('defaults settings and preserves explicit default-port provenance', () => {
  expect(parseUserSettings({})).toEqual({
    devtools: { enabled: true, port: 4545, open: false, portSource: 'default' },
  });
  expect(
    parseUserSettings({ devtools: { enabled: false, port: 4545, open: true } }),
  ).toEqual({
    devtools: { enabled: false, port: 4545, open: true, portSource: 'config' },
  });
  expect(parseUserSettings({ devtools: { port: 9000 } }).devtools.port).toBe(
    9000,
  );
});

it.each([0, -1, 65536, 1.5, '4545', null])(
  'rejects invalid port %s',
  (port) => {
    expect(() => parseUserSettings({ devtools: { port } })).toThrow(
      'Invalid Soundor user config',
    );
  },
);

it.each([{ enabled: 'true' }, { open: 1 }, { typo: true }])(
  'rejects invalid settings %j',
  (devtools) => {
    expect(() => parseUserSettings({ devtools })).toThrow();
  },
);

it('resolves platform paths, ignores relative environment paths, and honors explicit paths', () => {
  expect(
    userConfigPath({ platform: 'linux', home: '/users/me', env: {} }),
  ).toBe('/users/me/.config/soundor/config.json');
  expect(
    userConfigPath({
      platform: 'linux',
      home: '/users/me',
      env: { XDG_CONFIG_HOME: '/settings' },
    }),
  ).toBe('/settings/soundor/config.json');
  expect(
    userConfigPath({
      platform: 'linux',
      home: '/users/me',
      env: { XDG_CONFIG_HOME: 'relative' },
    }),
  ).toBe('/users/me/.config/soundor/config.json');
  expect(
    userConfigPath({ platform: 'darwin', home: '/Users/me', env: {} }),
  ).toBe('/Users/me/Library/Application Support/Soundor/config.json');
  expect(
    userConfigPath({
      platform: 'win32',
      home: 'C:\\Users\\me',
      env: { APPDATA: 'D:\\Roaming' },
    }),
  ).toBe('D:\\Roaming\\Soundor\\config.json');
  expect(
    userConfigPath({ platform: 'win32', home: 'C:\\Users\\me', env: {} }),
  ).toBe('C:\\Users\\me\\AppData\\Roaming\\Soundor\\config.json');
  expect(
    userConfigPath({
      path: '/explicit.json',
      platform: 'linux',
      env: { XDG_CONFIG_HOME: '/ignored' },
    }),
  ).toBe('/explicit.json');
});

it('loads JSON, defaults missing files, and reports file paths on errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'soundor-user-'));
  const path = join(dir, 'config.json');
  try {
    expect(await loadUserSettings({ path })).toEqual(parseUserSettings({}));
    await writeFile(path, JSON.stringify({ devtools: { enabled: false } }));
    expect((await loadUserSettings({ path })).devtools.enabled).toBe(false);
    await writeFile(path, '{broken');
    await expect(loadUserSettings({ path })).rejects.toThrow(path);
    await writeFile(path, '{"devtools":{"port":0}}');
    await expect(loadUserSettings({ path })).rejects.toMatchObject({
      kind: 'validation',
      issues: [{ path: 'devtools.port' }],
    });
    await expect(loadUserSettings({ path: dir })).rejects.toThrow(
      'Check file permissions',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
