import { describe, expect, it } from 'vitest';

import { buildWebDoctorReport } from './doctor';
import { makeCtx, tempProject } from './testing';

describe('buildWebDoctorReport', () => {
  it.each([
    ['20.19.0', 'ok'],
    ['20.18.3', 'fail'],
    ['21.7.0', 'fail'],
    ['22.12.0', 'ok'],
    ['22.11.0', 'fail'],
    ['24.0.0', 'ok'],
  ])(
    'checks Node.js %s against what Vite supports',
    async (version, status) => {
      const ctx = makeCtx(await tempProject());
      const report = await buildWebDoctorReport(ctx.fs, 'web', {
        nodeVersion: version,
        viteVersion: '8.0.0',
      });
      expect(report.checks[0]).toMatchObject({ label: 'Node.js', status });
      expect(report.checks[1]).toMatchObject({
        label: 'Vite',
        status: 'ok',
        detail: expect.stringContaining('vite 8.0.0'),
      });
    },
  );
});
