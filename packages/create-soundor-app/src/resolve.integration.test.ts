import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveProjectDependencies } from './resolve';

// Exercise real npm and pnpm resolvers, with no public registry access. The
// tree has a missing transitive engine version, then an available fallback.
async function registryFixture() {
  const requests: string[] = [];
  const old = '2020-01-01T00:00:00.000Z';
  const recent = new Date().toISOString();
  let origin = '';
  const server = createServer((request, response) => {
    const name = decodeURIComponent(request.url!.slice(1)).replace(/\/$/, '');
    requests.push(name);
    const versions =
      name === '@soundor/engine'
        ? ['0.7.0', '0.8.0']
        : ['0.12.0', '0.13.0', '0.14.0', '0.15.0'];
    response.setHeader('Content-Type', 'application/json');
    if (!['@soundor/juce-runtime', '@soundor/engine'].includes(name)) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    response.end(
      JSON.stringify({
        name,
        'dist-tags': { latest: versions.at(-1) },
        time: Object.fromEntries(
          versions.map((version) => [
            version,
            version === '0.14.0' ||
            (name === '@soundor/engine' && version === '0.8.0')
              ? recent
              : old,
          ]),
        ),
        versions: Object.fromEntries(
          versions.map((version) => [
            version,
            {
              name,
              version,
              ...(name === '@soundor/juce-runtime'
                ? {
                    dependencies: {
                      '@soundor/engine':
                        version === '0.15.0'
                          ? '0.9.0'
                          : version === '0.12.0'
                            ? '0.7.0'
                            : '0.8.0',
                    },
                  }
                : {}),
              dist: {
                tarball: `${origin}/${name}/-/${name.split('/').at(-1)}-${version}.tgz`,
                integrity: `sha512-${createHash('sha512').update(`${name}@${version}`).digest('base64')}`,
              },
            },
          ]),
        ),
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing registry address');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

describe('package-manager resolution', () => {
  it.each(['npm', 'pnpm'] as const)(
    '%s falls back for an unpublished engine and enforces age across the resolved tree',
    async (pm) => {
      const registry = await registryFixture();
      const dir = await mkdtemp(join(tmpdir(), 'soundor-registry-'));
      try {
        await writeFile(
          join(dir, '.npmrc'),
          [
            `registry=${registry.origin}`,
            // npm's date cutoff is available in all supported npm versions.
            ...(pm === 'npm' ? ['before=2025-01-01T00:00:00.000Z'] : []),
            'fetch-retries=0',
            '',
          ].join('\n'),
        );
        if (pm === 'pnpm') {
          await writeFile(
            join(dir, 'pnpm-workspace.yaml'),
            'minimumReleaseAge: 2880\nminimumReleaseAgeStrict: true\n',
          );
        }
        const result = await resolveProjectDependencies({
          pm,
          targetDir: dir,
          currentDirectory: true,
          manifest: {
            name: 'test-plugin',
            version: '0.0.0',
            private: true,
            dependencies: { '@soundor/juce-runtime': '0.15.0' },
          },
          golden: { '@soundor/juce-runtime': '0.15.0' },
          groups: [{ packages: ['@soundor/juce-runtime'], minimum: '0.12.0' }],
        });
        // 0.15.0 pins the missing engine; 0.14.0 is too young;
        // 0.13.0 itself is old enough but pins an engine that is too young.
        expect(result.versions).toEqual({ '@soundor/juce-runtime': '0.12.0' });
        expect(result.lockfile).toContain('0.7.0');
        expect(registry.requests).toContain('@soundor/engine');
        expect(await readdir(dir)).not.toContain('node_modules');
        expect(
          (await readdir(dir)).every(
            (name) => !name.startsWith('.soundor-create-'),
          ),
        ).toBe(true);
      } finally {
        await rm(dir, { recursive: true, force: true });
        await registry.close();
      }
    },
    30_000,
  );
});
