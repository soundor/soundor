import { describe, expect, it } from 'vitest';

import { vst3Doctor, vst3Runtime } from './index';
import { windowsLibraryProblem } from './link';
import { resolveVst3Options } from './options';

const probe = () => ({
  ok: true as const,
  version: '/usr/lib/gcc/libstdc++.a',
});

describe('vst3Runtime', () => {
  it('declares the DevTools its Debug builds have (soundor build vst3 --debug)', () => {
    expect(vst3Runtime.runtime.capabilities?.devtools).toMatchObject({
      inspector: true,
      input: true,
      capture: true,
    });
  });
});

describe('vst3Doctor', () => {
  const report = (present: string[]) =>
    vst3Doctor({} as never, {} as never, {
      platform: 'linux',
      arch: 'x64',
      probe,
      exists: (path) => present.includes(path),
    });

  it("finds the system's libcurl, fetch()'s HTTP stack", async () => {
    const { checks } = await report(['/usr/lib64/libcurl.so.4']);
    expect(checks.find((check) => check.label === 'libcurl (fetch)')).toEqual({
      label: 'libcurl (fetch)',
      status: 'ok',
      detail: '/usr/lib64/libcurl.so.4',
    });
  });

  it('accepts the GnuTLS build, as the plugins do', async () => {
    const { checks } = await report([
      '/usr/lib/x86_64-linux-gnu/libcurl-gnutls.so.4',
    ]);
    expect(
      checks.find((check) => check.label === 'libcurl (fetch)')?.status,
    ).toBe('ok');
  });

  it('warns, without failing, where there is none', async () => {
    const { checks } = await report([]);
    const check = checks.find((entry) => entry.label === 'libcurl (fetch)');
    expect(check?.status).toBe('warn');
    expect(check?.suggestion).toContain('libcurl');
  });
});

describe('source mode', () => {
  it('checks CMake and Ninja instead of the prebuilt adapters', async () => {
    const { checks } = await vst3Doctor(
      {} as never,
      { options: { engine: { mode: 'source' } } },
      {
        platform: 'linux',
        arch: 'x64',
        probe: (cmd) =>
          cmd === 'ninja'
            ? { ok: false as const, error: 'not found' }
            : probe(),
        exists: () => false,
      },
    );
    const labels = checks.map((check) => check.label);
    expect(labels).toContain('CMake (source mode)');
    expect(labels.some((label) => label.startsWith('Prebuilt adapter'))).toBe(
      false,
    );
    expect(
      checks.find((check) => check.label === 'Ninja (source mode)'),
    ).toMatchObject({
      status: 'fail',
      suggestion: expect.stringContaining('ninja'),
    });
  });

  it('accepts only prebuilt or source', () => {
    expect(resolveVst3Options({ engine: { mode: 'source' } }).engineMode).toBe(
      'source',
    );
    expect(resolveVst3Options(undefined).engineMode).toBe('prebuilt');
    expect(() =>
      resolveVst3Options({ engine: { mode: 'local' } } as never),
    ).toThrow(/expected \{ mode: 'prebuilt' \} or \{ mode: 'source' \}/);
  });
});

describe('the Windows SDK', () => {
  const msvc = () => ({
    linker: 'C:/VS/VC/Tools/MSVC/14.44/bin/Hostx64/x64/link.exe',
    libraryPaths: [
      '/vc/lib/x64',
      '/kits/10/Lib/10.0.26100.0/ucrt/x64',
      '/kits/10/Lib/10.0.26100.0/um/x64',
    ],
    source: 'C:/VS',
  });
  const doctor = (present: string[]) =>
    vst3Doctor({} as never, {} as never, {
      platform: 'win32',
      arch: 'x64',
      probe,
      msvc,
      exists: (path) => present.includes(path),
    });
  const sdk = <T extends { label: string }>(checks: readonly T[]) =>
    checks.find((check) => check.label === 'Windows SDK and C runtime');

  it('is found beside the C++ tools', async () => {
    const { checks } = await doctor([
      '/vc/lib/x64/libcmt.lib',
      '/kits/10/Lib/10.0.26100.0/ucrt/x64/libucrt.lib',
      '/kits/10/Lib/10.0.26100.0/um/x64/kernel32.lib',
    ]);
    expect(sdk(checks)).toMatchObject({ status: 'ok' });
  });

  it('fails, naming what to add, when Visual Studio has the C++ tools without an SDK', async () => {
    const { checks } = await doctor(['/vc/lib/x64/libcmt.lib']);
    const check = sdk(checks)!;
    expect(check.status).toBe('fail');
    expect(check.detail).toMatch(
      /kernel32\.lib \(the Windows SDK\), libucrt\.lib/,
    );
    expect(check.detail).not.toMatch(/libcmt/);
    expect(check.suggestion).toMatch(/Windows 11 SDK/);
  });
});

describe('windowsLibraryProblem', () => {
  it('names each missing library once, with one fix per component', () => {
    const message = windowsLibraryProblem([], () => false);
    expect(message).toMatch(/kernel32\.lib.*libucrt\.lib.*libcmt\.lib/);
    expect(message?.match(/Windows 11 SDK/g)).toHaveLength(1);
    expect(message).toMatch(/repair "Desktop development with C\+\+"/);
    expect(windowsLibraryProblem(['/a'], () => true)).toBeUndefined();
  });
});
