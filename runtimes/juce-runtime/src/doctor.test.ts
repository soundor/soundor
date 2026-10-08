import type { CommandProbe } from '@soundor/runtime-sdk';
import { describe, expect, it } from 'vitest';

import { buildDoctorReport } from './doctor';
import { memoryFs } from './testing';

const ok: CommandProbe = () => ({ ok: true, version: '1.2.3' });
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
      },
    );
    expect(report.checks.map((c) => c.status)).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
    ]);
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
