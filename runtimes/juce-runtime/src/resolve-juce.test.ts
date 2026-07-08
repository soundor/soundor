import { describe, expect, it } from 'vitest';

import { resolveJuceOptions } from './options';
import { resolveJuce } from './resolve-juce';
import { memoryFs } from './testing';

/** Seeds an in-memory JUCE checkout at `dir` (CMakeLists + modules/). */
function juceAt(dir: string) {
  return memoryFs('/proj', { [`${dir}/CMakeLists.txt`]: '# juce' }, [
    `${dir}/modules`,
  ]);
}

describe('resolveJuce', () => {
  it('finds JUCE via the jucePath option', async () => {
    const fs = juceAt('/opt/my-juce');
    const resolution = await resolveJuce(
      fs,
      resolveJuceOptions({ jucePath: '/opt/my-juce' }),
      {},
    );
    expect(resolution).toMatchObject({
      found: true,
      path: '/opt/my-juce',
      source: 'option',
    });
  });

  it('finds JUCE via JUCE_DIR', async () => {
    const fs = juceAt('/opt/env-juce');
    const resolution = await resolveJuce(fs, resolveJuceOptions({}), {
      JUCE_DIR: '/opt/env-juce',
    });
    expect(resolution).toMatchObject({ found: true, source: 'env' });
  });

  it('prefers the jucePath option over JUCE_DIR', async () => {
    const fs = memoryFs(
      '/proj',
      {
        '/opt/opt-juce/CMakeLists.txt': '#',
        '/opt/env-juce/CMakeLists.txt': '#',
      },
      ['/opt/opt-juce/modules', '/opt/env-juce/modules'],
    );
    const resolution = await resolveJuce(
      fs,
      resolveJuceOptions({ jucePath: '/opt/opt-juce' }),
      { JUCE_DIR: '/opt/env-juce' },
    );
    expect(resolution).toMatchObject({ found: true, source: 'option' });
  });

  it('finds JUCE in a project-local checkout', async () => {
    const fs = juceAt('/proj/JUCE');
    const resolution = await resolveJuce(
      fs,
      resolveJuceOptions({}),
      {},
      {
        platform: 'linux',
      },
    );
    expect(resolution).toMatchObject({
      found: true,
      path: '/proj/JUCE',
      source: 'well-known',
    });
  });

  it('finds JUCE in a Linux home SDK checkout', async () => {
    const fs = juceAt('/home/me/SDKs/JUCE');
    const resolution = await resolveJuce(
      fs,
      resolveJuceOptions({}),
      {},
      {
        platform: 'linux',
        homeDir: '/home/me',
      },
    );
    expect(resolution).toMatchObject({
      found: true,
      path: '/home/me/SDKs/JUCE',
      source: 'well-known',
    });
  });

  it('probes conservative platform-specific paths', async () => {
    const fs = memoryFs('/proj');
    const mac = await resolveJuce(
      fs,
      resolveJuceOptions({}),
      {},
      {
        platform: 'darwin',
        homeDir: '/Users/me',
      },
    );
    expect(mac.searched).toEqual([
      '/proj/JUCE',
      '/Users/me/JUCE',
      '/Users/me/SDKs/JUCE',
      '/Applications/JUCE',
      '/opt/JUCE',
    ]);

    const winFs = { ...fs, resolve: (...segments: string[]) => segments[0]! };
    const win = await resolveJuce(
      winFs,
      resolveJuceOptions({}),
      {},
      {
        platform: 'win32',
      },
    );
    expect(win.searched).toEqual(['./JUCE', 'C:\\JUCE', 'C:\\SDKs\\JUCE']);
  });

  it('reports not found and lists the paths it actually considered', async () => {
    const fs = memoryFs('/proj');
    const resolution = await resolveJuce(
      fs,
      resolveJuceOptions({ jucePath: './JUCE' }),
      {},
      { platform: 'linux' },
    );
    expect(resolution.found).toBe(false);
    expect(resolution.searched).toEqual(['/proj/JUCE', '/opt/JUCE']);
  });

  it('ignores a directory missing the JUCE markers', async () => {
    // CMakeLists present but no modules/ dir → not a JUCE checkout.
    const fs = memoryFs('/proj', { '/opt/x/CMakeLists.txt': '# not juce' });
    const resolution = await resolveJuce(
      fs,
      resolveJuceOptions({ jucePath: '/opt/x' }),
      {},
    );
    expect(resolution.found).toBe(false);
  });
});
