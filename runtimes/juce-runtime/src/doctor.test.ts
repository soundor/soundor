import type { CommandProbe } from '@soundor/runtime-sdk';
import { describe, expect, it } from 'vitest';

import { buildDoctorReport } from './doctor';
import { resolveJuceOptions } from './options';
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
      resolveJuceOptions({ jucePath: '/proj/JUCE' }),
      {
        probe: ok,
        env: {},
      },
    );
    expect(report.checks.map((c) => c.status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('reports a missing CMake with a suggestion', async () => {
    const fs = memoryFs('/proj', { '/proj/JUCE/CMakeLists.txt': '#' }, [
      '/proj/JUCE/modules',
    ]);
    const report = await buildDoctorReport(
      fs,
      resolveJuceOptions({ jucePath: '/proj/JUCE' }),
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
      resolveJuceOptions({ jucePath: '/proj/JUCE' }),
      {
        probe: (cmd) => (cmd === 'cmake' ? ok('cmake') : missing(cmd)),
        env: {},
      },
    );
    expect(check(report, 'C++ compiler').status).toBe('fail');
  });

  it('reports missing JUCE with an actionable suggestion', async () => {
    const report = await buildDoctorReport(
      memoryFs('/proj'),
      resolveJuceOptions({}),
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
