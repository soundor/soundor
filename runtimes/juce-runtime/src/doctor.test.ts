import { createNodeFileSystem } from '@soundor/core';
import type { CommandProbe } from '@soundor/runtime-sdk';
import { describe, expect, it } from 'vitest';

import type { HostModule } from './dev-host';
import { buildDoctorReport, type DoctorDeps } from './doctor';
import { memoryFs } from './testing';

const ok: CommandProbe = (_command, args) => ({
  ok: true,
  version: args?.[0]?.startsWith('-print-file-name=')
    ? '/usr/lib/gcc/x86_64-linux-gnu/14/libstdc++.a'
    : '1.2.3',
});
const missing: CommandProbe = () => ({ ok: false, error: 'not found' });

function check(
  report: Awaited<ReturnType<typeof buildDoctorReport>>,
  label: string,
) {
  return report.checks.find((c) => c.label === label)!;
}

describe('buildDoctorReport', () => {
  it('reports ok when the full toolchain is present', async () => {
    const fs = memoryFs('/proj', { '/proj/JUCE/CMakeLists.txt': '#' }, [
      '/proj/JUCE/modules',
    ]);
    const report = await buildDoctorReport(
      fs,
      { jucePath: '/proj/JUCE' },
      {
        probe: ok,
        env: {},
        engine: {
          version: '0.2.1',
          manifest: {
            tag: 'engine-prebuilts-v0.2.1-a3f91c2d-r1',
            artifacts: [
              { target: 'linux-x64', variant: 'debug' },
              { target: 'linux-x64', variant: 'release' },
            ],
          },
        },
        platform: 'linux',
        arch: 'x64',
        glibc: '2.39',
      },
    );
    expect(report.checks.map((c) => c.status)).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
    ]);
  });

  describe('on Linux', () => {
    const report = async (
      label: string,
      deps: { probe?: CommandProbe; env?: NodeJS.ProcessEnv; glibc?: string },
      platform: NodeJS.Platform = 'linux',
    ) =>
      (
        await buildDoctorReport(
          memoryFs('/proj'),
          { formats: ['standalone'] },
          {
            probe: ok,
            env: {},
            platform,
            arch: 'x64',
            engine: { version: '0.2.1' },
            glibc: '2.39',
            ...deps,
          },
        )
      ).checks.find((entry) => entry.label === label);
    const missing: CommandProbe = (command, args) =>
      args?.[0] === '-print-file-name=libstdc++.a'
        ? { ok: true, version: 'libstdc++.a' }
        : ok(command, args);

    it('finds the static C++ runtime', async () => {
      expect(await report('Static C++ runtime', {})).toMatchObject({
        status: 'ok',
        detail: '/usr/lib/gcc/x86_64-linux-gnu/14/libstdc++.a',
      });
    });

    it('fails without it, and says what to install', async () => {
      const check = await report('Static C++ runtime', { probe: missing });
      expect(check?.status).toBe('fail');
      expect(check?.suggestion).toContain('dnf install libstdc++-static');
    });

    it('asks the compiler a build would use', async () => {
      const asked: string[] = [];
      await report('Static C++ runtime', {
        env: { CXX: 'clang++-18 -stdlib=libstdc++' },
        probe: (command, args) => {
          asked.push(command);
          return ok(command, args);
        },
      });
      expect(asked).toContain('clang++-18');
    });

    it('warns of a glibc newer than the baseline', async () => {
      expect((await report('glibc', { glibc: '2.39' }))?.status).toBe('ok');
      const check = await report('glibc', { glibc: '2.43' });
      expect(check?.status).toBe('warn');
      expect(check?.detail).toContain('Ubuntu 24.04');
    });

    it('has nothing to say on other platforms', async () => {
      expect(await report('glibc', {}, 'darwin')).toBeUndefined();
      expect(await report('Static C++ runtime', {}, 'win32')).toBeUndefined();
    });
  });

  describe('a prebuilt engine on Windows', () => {
    const artifacts = (...variants: string[]) =>
      variants.map((variant) => ({ target: 'windows-x64', variant }));
    const status = async (
      crt: 'MT' | 'MD' | undefined,
      variants: readonly string[],
    ) =>
      check(
        await buildDoctorReport(
          memoryFs('/proj'),
          {
            windows: crt === undefined ? {} : { crt },
            formats: ['standalone'],
          },
          {
            probe: ok,
            env: {},
            platform: 'win32',
            arch: 'x64',
            engine: {
              version: '0.2.1',
              manifest: { tag: 'r1', artifacts: artifacts(...variants) },
            },
          },
        ),
        'Soundor Engine',
      ).status;

    it('needs the archives of the C runtime in use', async () => {
      const dll = ['debug', 'release'];
      const both = [...dll, 'debug-static', 'release-static'];
      expect(await status(undefined, both)).toBe('ok');
      expect(await status('MT', both)).toBe('ok');
      expect(await status('MD', dll)).toBe('ok');
      expect(await status(undefined, dll)).toBe('fail');
      expect(await status('MT', dll)).toBe('fail');
      expect(await status('MD', ['debug-static', 'release-static'])).toBe(
        'fail',
      );
    });
  });

  describe('the Metal tools', () => {
    const report = (
      platform: NodeJS.Platform,
      mode: 'source' | 'prebuilt',
      probe: CommandProbe = ok,
    ) =>
      buildDoctorReport(
        memoryFs('/proj'),
        { engine: { mode }, formats: ['standalone'] },
        {
          probe,
          platform,
          arch: 'arm64',
          env: {},
          engine: { version: '0.2.1' },
        },
      ).then((result) =>
        result.checks.find((entry) => entry.label === 'Metal tools'),
      );
    const withoutMetal: CommandProbe = (command) =>
      command === 'xcrun' ? { ok: false, error: 'no metal' } : ok(command, []);

    it('are fine when xcrun finds them', async () => {
      expect((await report('darwin', 'source'))?.status).toBe('ok');
    });

    it('say how to get them when building from source', async () => {
      const check = await report('darwin', 'source', withoutMetal);
      expect(check?.status).toBe('warn');
      expect(check?.suggestion).toContain('xcode-select --switch');
      expect(check?.suggestion).toContain('MetalToolchain');
    });

    it('are not needed with a prebuilt engine', async () => {
      expect(await report('darwin', 'prebuilt', withoutMetal)).toBeUndefined();
    });

    it('are not checked outside macOS', async () => {
      expect(await report('linux', 'source', withoutMetal)).toBeUndefined();
    });
  });

  describe('the VST3 host', () => {
    const report = (
      loadHost: DoctorDeps['loadHost'],
      options: Parameters<typeof buildDoctorReport>[1] = {},
    ) =>
      buildDoctorReport(createNodeFileSystem(process.cwd()), options, {
        loadHost,
      }).then((result) =>
        result.checks.find((check) => check.label === 'VST3 host'),
      );

    it('is fine without it', async () => {
      expect((await report(async () => undefined))?.status).toBe('ok');
    });

    it('says where it runs from', async () => {
      const check = await report(
        async () =>
          ({
            resolveHost: () => ({ executable: '/host', source: 'package' }),
          }) as unknown as HostModule,
      );
      expect(check).toMatchObject({ status: 'ok', detail: '/host (package)' });
    });

    it('warns of one that cannot run', async () => {
      const check = await report(
        async () =>
          ({
            resolveHost: () => {
              throw new Error('no executable');
            },
          }) as unknown as HostModule,
      );
      expect(check).toMatchObject({ status: 'warn', detail: 'no executable' });
    });

    it('is not checked without the VST3 format', async () => {
      expect(
        await report(async () => undefined, { formats: ['standalone'] }),
      ).toBeUndefined();
    });
  });

  const published = {
    version: '0.2.1',
    manifest: {
      tag: 'engine-prebuilts-v0.2.1-a3f91c2d-r1',
      artifacts: ['debug', 'release'].map((variant) => ({
        target: 'linux-x64',
        variant,
      })),
    },
  };
  async function engineCheck(
    deps: Parameters<typeof buildDoctorReport>[2],
    mode?: 'prebuilt' | 'source',
  ) {
    const fs = memoryFs('/proj', { '/proj/JUCE/CMakeLists.txt': '#' }, [
      '/proj/JUCE/modules',
    ]);
    const report = await buildDoctorReport(
      fs,
      { jucePath: '/proj/JUCE', engine: mode ? { mode } : undefined },
      { probe: ok, env: {}, ...deps },
    );
    return check(report, 'Soundor Engine');
  }

  it('names the prebuilt release a build downloads', async () => {
    expect(
      await engineCheck(
        { engine: published, platform: 'linux', arch: 'x64' },
        'prebuilt',
      ),
    ).toMatchObject({
      status: 'ok',
      detail: expect.stringContaining(
        'engine-prebuilts-v0.2.1-a3f91c2d-r1 (linux-x64',
      ),
    });
  });

  it('suggests source mode where no prebuilt engine can be used', async () => {
    for (const deps of [
      { engine: published, platform: 'win32' as const, arch: 'x64' },
      { engine: published, platform: 'linux' as const, arch: 'arm64' },
    ])
      expect(await engineCheck(deps, 'prebuilt')).toMatchObject({
        status: 'fail',
        suggestion: expect.stringContaining("mode: 'source'"),
      });
    expect(
      await engineCheck(
        { engine: { version: '0.2.1' }, platform: 'linux', arch: 'arm64' },
        'source',
      ),
    ).toMatchObject({
      status: 'ok',
      detail: expect.stringContaining('Source mode'),
    });
  });

  it('names the tools missing to build Skia and ANGLE', async () => {
    const fs = memoryFs('/proj', { '/proj/JUCE/CMakeLists.txt': '#' }, [
      '/proj/JUCE/modules',
    ]);
    const report = await buildDoctorReport(
      fs,
      { jucePath: '/proj/JUCE' },
      {
        probe: (cmd) =>
          cmd === 'ninja' || cmd.startsWith('python') ? missing(cmd) : ok(cmd),
        env: {},
      },
    );
    expect(check(report, 'Skia and ANGLE build tools')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('Missing Python 3, ninja'),
      suggestion: 'Install Python 3, ninja and make them available on PATH.',
    });
  });

  it('accepts python as Python 3 (Windows)', async () => {
    const fs = memoryFs('/proj', { '/proj/JUCE/CMakeLists.txt': '#' }, [
      '/proj/JUCE/modules',
    ]);
    const report = await buildDoctorReport(
      fs,
      { jucePath: '/proj/JUCE' },
      {
        probe: (cmd) => (cmd === 'python3' ? missing(cmd) : ok(cmd)),
        env: {},
      },
    );
    expect(check(report, 'Skia and ANGLE build tools').status).toBe('ok');
  });

  it('reports a missing CMake with a suggestion', async () => {
    const fs = memoryFs('/proj', { '/proj/JUCE/CMakeLists.txt': '#' }, [
      '/proj/JUCE/modules',
    ]);
    const report = await buildDoctorReport(
      fs,
      { jucePath: '/proj/JUCE' },
      {
        probe: (cmd) => (cmd === 'cmake' ? missing('cmake') : ok('x')),
        env: {},
      },
    );
    const cmake = check(report, 'CMake');
    expect(cmake.status).toBe('fail');
    expect(cmake.suggestion).toMatch(/Install CMake/);
  });

  it('reports a missing compiler when every front-end fails', async () => {
    const fs = memoryFs('/proj', { '/proj/JUCE/CMakeLists.txt': '#' }, [
      '/proj/JUCE/modules',
    ]);
    const report = await buildDoctorReport(
      fs,
      { jucePath: '/proj/JUCE' },
      {
        probe: (cmd) => (cmd === 'cmake' ? ok('cmake') : missing(cmd)),
        env: {},
      },
    );
    expect(check(report, 'C++ compiler').status).toBe('fail');
  });

  it('does not accept a C compiler as the C++ compiler', async () => {
    const fs = memoryFs('/proj', { '/proj/JUCE/CMakeLists.txt': '#' }, [
      '/proj/JUCE/modules',
    ]);
    const report = await buildDoctorReport(
      fs,
      { jucePath: '/proj/JUCE' },
      {
        probe: (cmd) =>
          cmd === 'cmake' || cmd === 'cc' ? ok(cmd) : missing(cmd),
        env: {},
      },
    );
    expect(check(report, 'C++ compiler').status).toBe('fail');
  });

  it('reports missing JUCE with an actionable suggestion', async () => {
    const report = await buildDoctorReport(
      memoryFs('/proj'),
      {},
      {
        probe: ok,
        env: {},
      },
    );
    const juce = check(report, 'JUCE');
    expect(juce.status).toBe('fail');
    expect(juce.suggestion).toMatch(/jucePath|JUCE_DIR/);
  });
});
