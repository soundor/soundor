// Generated platform packages, their tarballs, and the resumable publisher.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  type CheckedTarball,
  addOptionalDependencies,
  checkMain,
  checkTarballs,
  generate,
  pack,
  plannedHost,
  publish,
  verify,
} from '../../scripts/release.ts';
import { readTarball } from '../../src/npm.ts';
import { targets } from '../../src/targets.ts';
import {
  COMMIT,
  type FakeRegistry,
  artifact,
  fakeRegistry,
  npmPack,
  packageCopy,
  temporary,
} from './helpers.ts';

function artifacts(fields: Parameters<typeof artifact>[2] = {}): string {
  const root = temporary();
  for (const target of targets)
    artifact(join(root, target.target), target, fields);
  return root;
}

function packed(fields: Parameters<typeof artifact>[2] = {}): string {
  const root = packageCopy();
  const packages = join(temporary(), 'packages');
  generate({
    artifacts: artifacts(fields),
    out: packages,
    commit: COMMIT,
    root,
  });
  const out = temporary();
  pack(packages, out);
  return out;
}

describe('platform packages', () => {
  test('are generated and packed with exact versions, platforms, notices and executables', () => {
    const out = packed();
    const checked = checkTarballs(out, { version: '0.3.0', commit: COMMIT });
    expect(checked.map((entry) => basename(entry.path))).toEqual([
      'soundor-vst3-host-linux-x64-gnu-0.3.0.tgz',
      'soundor-vst3-host-darwin-universal-0.3.0.tgz',
      'soundor-vst3-host-win32-x64-0.3.0.tgz',
    ]);
    const entries = readTarball(readFileSync(checked[1]!.path));
    const manifest = JSON.parse(
      entries.find((e) => e.path === 'package.json')!.data.toString(),
    );
    expect(manifest).toMatchObject({
      name: '@soundor/vst3-host-darwin-universal',
      version: '0.3.0',
      os: ['darwin'],
      cpu: ['arm64', 'x64'],
      license: 'MIT',
    });
    expect(manifest.scripts).toBeUndefined();
    const linux = JSON.parse(
      readTarball(readFileSync(checked[0]!.path))
        .find((e) => e.path === 'package.json')!
        .data.toString(),
    );
    expect(linux.libc).toEqual(['glibc']);
    expect(entries.map((e) => e.path).sort()).toEqual([
      'LICENSE',
      'NOTICE.md',
      'README.md',
      'bin/soundor-vst3-host',
      'licenses/vst3sdk/LICENSE.txt',
      'package.json',
      'soundor-vst3-host.json',
    ]);
    expect(
      entries.find((e) => e.path === 'bin/soundor-vst3-host')!.mode & 0o111,
    ).toBe(0o111);
  });

  test('refuse a set built from different commits or sources', () => {
    const root = packageCopy();
    const mixed = artifacts();
    artifact(join(mixed, 'win32-x64'), targets[2]!, {
      sourceFingerprint: 'e'.repeat(64),
    });
    expect(() =>
      generate({ artifacts: mixed, out: temporary(), root }),
    ).toThrow(/native inputs differ/);
    expect(() =>
      generate({
        artifacts: artifacts(),
        out: temporary(),
        commit: 'b'.repeat(40),
        root,
      }),
    ).toThrow(/built from a3f91c2d/);
    expect(() =>
      generate({
        artifacts: artifacts({ version: '0.2.0' }),
        out: temporary(),
        root,
      }),
    ).toThrow(/version 0\.2\.0, not 0\.3\.0/);
  });

  test('tarballs of another version are not published', () => {
    expect(() => checkTarballs(packed(), { version: '0.3.1' })).toThrow(
      /has no soundor-vst3-host-linux-x64-gnu-0\.3\.1\.tgz/,
    );
  });
});

describe('the main package', () => {
  test('pins every platform package exactly', () => {
    const root = packageCopy();
    expect(addOptionalDependencies(root)).toEqual({
      '@soundor/vst3-host-linux-x64-gnu': '0.3.0',
      '@soundor/vst3-host-darwin-universal': '0.3.0',
      '@soundor/vst3-host-win32-x64': '0.3.0',
    });
    const manifest = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    );
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ ...manifest, files: ['README.md'] }),
    );
    const out = temporary();
    npmPack(root, out);
    expect(() => checkMain(out, '0.3.0')).not.toThrow();
    expect(() => checkMain(out, '0.3.1')).toThrow(/does not pin/);
  });

  test('is found in the publish plan', () => {
    const entry = (name: string, version: string) => ({
      kind: 'publish',
      name,
      version,
    });
    expect(
      plannedHost({
        version: 1,
        plan: [
          [
            entry('@soundor/core', '0.16.0'),
            entry('@soundor/vst3-host', '0.3.0'),
          ],
        ],
      }),
    ).toBe('0.3.0');
    expect(
      plannedHost({ version: 1, plan: [[entry('@soundor/core', '0.16.0')]] }),
    ).toBeNull();
    expect(() => plannedHost({ version: 2 })).toThrow(/Unknown/);
  });
});

describe('publishing', () => {
  let registry: FakeRegistry;
  beforeAll(async () => {
    registry = await fakeRegistry();
  });
  afterAll(() => registry.close());

  const quiet = () => {};
  function publisherInto(target: FakeRegistry, fail: string[] = []) {
    const published: string[] = [];
    return {
      published,
      publisher: async (tarball: string) => {
        const name = basename(tarball);
        if (fail.some((part) => name.includes(part)))
          throw new Error(`E503 publishing ${name}`);
        const manifest = JSON.parse(
          readTarball(readFileSync(tarball))
            .find((e) => e.path === 'package.json')!
            .data.toString(),
        );
        target.versions.set(
          `${manifest.name}@${manifest.version}`,
          readFileSync(tarball),
        );
        published.push(manifest.name);
      },
    };
  }

  test('resumes a partial release: verifies what is there, publishes the rest', async () => {
    registry.versions.clear();
    const tarballs = checkTarballs(packed(), { version: '0.3.0' });

    const first = publisherInto(registry, ['win32']);
    await expect(
      publish(tarballs, {
        registry: registry.url,
        publisher: first.publisher,
        log: quiet,
      }),
    ).rejects.toThrow(/E503/);
    expect(first.published).toEqual([
      '@soundor/vst3-host-linux-x64-gnu',
      '@soundor/vst3-host-darwin-universal',
    ]);
    await expect(verify(tarballs, { registry: registry.url })).rejects.toThrow(
      /win32-x64@0\.3\.0/,
    );

    // The retry: rebuilt bytes, same native inputs.
    const retried = checkTarballs(packed({ bytes: Buffer.from('rebuilt') }), {
      version: '0.3.0',
    });
    const second = publisherInto(registry);
    const outcomes = await publish(retried, {
      registry: registry.url,
      publisher: second.publisher,
      log: quiet,
    });
    expect(outcomes).toEqual({
      '@soundor/vst3-host-linux-x64-gnu': 'verified',
      '@soundor/vst3-host-darwin-universal': 'verified',
      '@soundor/vst3-host-win32-x64': 'published',
    });
    await verify(retried, { registry: registry.url });
  });

  test('never overwrites a version published from other sources', async () => {
    registry.versions.clear();
    const published = checkTarballs(packed(), { version: '0.3.0' });
    await publish(published, {
      registry: registry.url,
      publisher: publisherInto(registry).publisher,
      log: quiet,
    });
    const different = checkTarballs(
      packed({ sourceFingerprint: 'e'.repeat(64) }),
      { version: '0.3.0' },
    );
    const attempt = publisherInto(registry);
    await expect(
      publish(different, {
        registry: registry.url,
        publisher: attempt.publisher,
        log: quiet,
      }),
    ).rejects.toThrow(/already published from other native inputs/);
    expect(attempt.published).toEqual([]);
  });

  test('fails on registry errors without publishing anything', async () => {
    registry.versions.clear();
    const tarballs = checkTarballs(packed(), { version: '0.3.0' });
    const attempt = publisherInto(registry);
    registry.failWith = 401;
    try {
      await expect(
        publish(tarballs, {
          registry: registry.url,
          publisher: attempt.publisher,
          log: quiet,
        }),
      ).rejects.toThrow(/HTTP 401/);
    } finally {
      registry.failWith = undefined;
    }
    expect(attempt.published).toEqual([]);
  });

  test('accepts a concurrent publish of the same build, and not of another', async () => {
    registry.versions.clear();
    const tarballs: CheckedTarball[] = checkTarballs(packed(), {
      version: '0.3.0',
    });
    // Another run publishes first; this run's publish then fails.
    const racing = async (tarball: string) => {
      await publisherInto(registry).publisher(tarball);
      throw new Error(
        'E403 cannot publish over the previously published version',
      );
    };
    const outcomes = await publish(tarballs, {
      registry: registry.url,
      publisher: racing,
      log: quiet,
    });
    expect(Object.values(outcomes)).toEqual([
      'verified',
      'verified',
      'verified',
    ]);

    registry.versions.clear();
    const other = checkTarballs(packed({ sourceFingerprint: 'e'.repeat(64) }), {
      version: '0.3.0',
    });
    const racingOther = async (tarball: string) => {
      const name = basename(tarball);
      const target = other.find((entry) => basename(entry.path) === name)!;
      registry.versions.set(
        `${target.target.package}@0.3.0`,
        readFileSync(tarballs.find((t) => t.target === target.target)!.path),
      );
      throw new Error('E403');
    };
    await expect(
      publish(other, {
        registry: registry.url,
        publisher: racingOther,
        log: quiet,
      }),
    ).rejects.toThrow(/other native inputs/);
  });
});
