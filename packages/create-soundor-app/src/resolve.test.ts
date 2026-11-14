import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  isReadinessFailure,
  PackageManagerError,
  resolutionArguments,
  resolveProjectDependencies,
  selectVersions,
} from './resolve';
import {
  activeReleaseGroups,
  compareVersions,
  stableVersion,
} from './template-support';

const groups = [
  { packages: ['soundor', '@soundor/config'], minimum: '0.14.0' },
  { packages: ['@soundor/juce-runtime'], minimum: '0.12.0' },
];
const golden = {
  soundor: '0.15.0',
  '@soundor/config': '0.15.0',
  '@soundor/juce-runtime': '0.14.0',
};
const unavailable = () =>
  new PackageManagerError(
    'ETARGET No matching version found for @soundor/engine@0.9.0',
  );

it('compares stable versions numerically and rejects prerelease fallback', () => {
  expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
  expect(stableVersion('0.15.0-rc.1')).toBeUndefined();
  expect(stableVersion('0.015.0')).toBeUndefined();
});

it('validates template minimums and fixed-group golden versions', () => {
  expect(() => activeReleaseGroups({ soundor: '0.13.0' }, groups)).toThrow(
    'exceeds',
  );
  expect(() =>
    activeReleaseGroups(
      { soundor: '0.15.0', '@soundor/config': '0.14.0' },
      groups,
    ),
  ).toThrow('different golden');
});

describe('selectVersions', () => {
  it('tries golden versions before querying the registry for older releases', async () => {
    const published = vi.fn<(name: string) => Promise<readonly string[]>>();
    const resolve = vi
      .fn<(versions: Readonly<Record<string, string>>) => Promise<void>>()
      .mockResolvedValue(undefined);
    expect(
      await selectVersions({ golden, groups, published, resolve }),
    ).toEqual(golden);
    expect(published).not.toHaveBeenCalled();
  });

  it('falls back independently when a runtime pins an unavailable engine, keeping the fixed group together', async () => {
    const attempts: Record<string, string>[] = [];
    const result = await selectVersions({
      golden,
      groups,
      published: async () => [
        '0.1.0',
        '0.12.0',
        '0.13.0',
        '0.14.0',
        '0.15.0',
        '0.16.0',
        '0.14.1-rc.1',
      ],
      resolve: async (versions) => {
        attempts.push({ ...versions });
        if (versions['@soundor/juce-runtime'] !== '0.13.0') throw unavailable();
      },
    });
    expect(result).toEqual({ ...golden, '@soundor/juce-runtime': '0.13.0' });
    expect(attempts).toEqual([golden, result]);
  });

  it('requires every fixed-group member to have the same published fallback version', async () => {
    const result = await selectVersions({
      golden,
      groups,
      published: async (name) =>
        name === '@soundor/config' ? ['0.14.0'] : ['0.14.0', '0.14.1'],
      resolve: async (versions) => {
        if (versions['soundor'] !== '0.14.0') throw unavailable();
      },
    });
    expect(result).toEqual({
      ...golden,
      soundor: '0.14.0',
      '@soundor/config': '0.14.0',
    });
  });

  it('tries combinations of independently released packages', async () => {
    const result = await selectVersions({
      golden,
      groups,
      published: async () => ['0.12.0', '0.13.0', '0.14.0'],
      resolve: async (versions) => {
        if (
          versions['soundor'] !== '0.14.0' ||
          versions['@soundor/juce-runtime'] !== '0.13.0'
        )
          throw unavailable();
      },
    });
    expect(result).toEqual({
      soundor: '0.14.0',
      '@soundor/config': '0.14.0',
      '@soundor/juce-runtime': '0.13.0',
    });
  });

  it('continues past peer conflicts introduced by a fallback combination', async () => {
    const result = await selectVersions({
      golden,
      groups,
      published: async () => ['0.13.0', '0.14.0'],
      resolve: async (versions) => {
        if (versions['soundor'] === '0.15.0') throw unavailable();
        if (versions['@soundor/juce-runtime'] === '0.14.0')
          throw new PackageManagerError('ERESOLVE incompatible runtime peer');
      },
    });
    expect(result).toEqual({
      soundor: '0.14.0',
      '@soundor/config': '0.14.0',
      '@soundor/juce-runtime': '0.13.0',
    });
  });

  it('does not query unused runtime or host groups', async () => {
    const published = vi
      .fn<(name: string) => Promise<readonly string[]>>()
      .mockResolvedValue(['0.14.0']);
    await selectVersions({
      golden: { soundor: '0.15.0' },
      groups,
      published,
      resolve: async (versions) => {
        if (versions['soundor'] === '0.15.0') throw unavailable();
      },
    });
    expect(published).toHaveBeenCalledExactlyOnceWith('soundor');
  });

  it.each([
    'EAI_AGAIN',
    'E401',
    'E403',
    'ERESOLVE',
    'ERR_PNPM_PEER_DEP_ISSUES',
    'ENOENT',
    'CERT_HAS_EXPIRED',
  ])(
    'preserves %s instead of suggesting waiting or changing policy',
    async (code) => {
      const error = new PackageManagerError(`${code}: actual failure`);
      const published = vi.fn<(name: string) => Promise<readonly string[]>>();
      await expect(
        selectVersions({
          golden,
          groups,
          published,
          resolve: async () => {
            throw error;
          },
        }),
      ).rejects.toBe(error);
      expect(published).not.toHaveBeenCalled();
    },
  );

  it('explains age policy failures without weakening the policy', async () => {
    await expect(
      selectVersions({
        golden: { soundor: '0.15.0' },
        groups: [{ packages: ['soundor'], minimum: '0.15.0' }],
        published: vi.fn<(name: string) => Promise<readonly string[]>>(),
        resolve: async () => {
          throw new PackageManagerError(
            'ERR_PNPM_NO_MATCHING_VERSION minimumReleaseAge: 2880',
          );
        },
      }),
    ).rejects.toThrow('release-age policy');
  });

  it('does not fall below the template minimum or above the golden version', async () => {
    const resolve = vi
      .fn<(versions: Readonly<Record<string, string>>) => Promise<void>>()
      .mockRejectedValue(unavailable());
    await expect(
      selectVersions({
        golden: { soundor: '0.15.0' },
        groups: [groups[0]!],
        published: async () => [
          '0.13.9',
          '0.14.0',
          '0.14.1',
          '0.15.1',
          '1.0.0',
        ],
        resolve,
      }),
    ).rejects.toThrow('awaiting publication');
    expect(resolve.mock.calls.map(([versions]) => versions['soundor'])).toEqual(
      ['0.15.0', '0.14.1', '0.14.0'],
    );
  });
});

it.each(['npm', 'pnpm'] as const)(
  'resolves with %s, retains its lockfile and cleans scratch files without touching existing files',
  async (pm) => {
    const dir = await mkdtemp(join(tmpdir(), 'soundor-resolve-'));
    const calls: string[][] = [];
    try {
      await writeFile(join(dir, 'keep.txt'), 'original');
      await writeFile(join(dir, '.npmrc'), 'registry=http://localhost:12345\n');
      const lock = pm === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml';
      const result = await resolveProjectDependencies({
        pm,
        targetDir: dir,
        currentDirectory: true,
        manifest: {
          name: 'test',
          dependencies: { soundor: '0.15.0', react: '^19.0.0' },
        },
        golden: { soundor: '0.15.0' },
        groups: [{ packages: ['soundor'], minimum: '0.15.0' }],
        run: async (args, cwd) => {
          calls.push([...args]);
          expect(await readFile(join(cwd, '.npmrc'), 'utf-8')).toContain(
            'localhost',
          );
          const manifest = JSON.parse(
            await readFile(join(cwd, 'package.json'), 'utf-8'),
          );
          expect(manifest.dependencies).toEqual({
            soundor: '0.15.0',
            react: '^19.0.0',
          });
          await writeFile(join(cwd, lock), 'resolved graph');
          return '';
        },
      });
      expect(result.lockfile).toBe('resolved graph');
      expect(calls).toEqual([resolutionArguments(pm)]);
      expect(await readFile(join(dir, 'keep.txt'), 'utf-8')).toBe('original');
      expect((await readdir(dir)).sort()).toEqual(['.npmrc', 'keep.txt']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

it('removes scratch files after a failed resolution and leaves the target untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'soundor-resolve-'));
  try {
    await writeFile(join(dir, 'keep.txt'), 'original');
    await expect(
      resolveProjectDependencies({
        pm: 'npm',
        targetDir: dir,
        currentDirectory: true,
        manifest: { dependencies: { soundor: '0.15.0' } },
        golden: { soundor: '0.15.0' },
        groups: [{ packages: ['soundor'], minimum: '0.15.0' }],
        run: async () => {
          throw unavailable();
        },
      }),
    ).rejects.toThrow('No supported dependency combination');
    expect(await readdir(dir)).toEqual(['keep.txt']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('does not treat arbitrary exceptions mentioning a registry error as readiness failures', () => {
  expect(isReadinessFailure(new Error('ETARGET'))).toBe(false);
});
