import { describe, expect, it } from 'vitest';

import { vst3Doctor, vst3Runtime } from './index';

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
