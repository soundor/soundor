import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ArgsDef, CommandMeta } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  doctorCommand,
  formatDoctorResult,
  runDoctor,
  toJsonReport,
} from './doctor';

vi.mock('@clack/prompts', () => ({
  outro: vi.fn<() => void>(),
  spinner: vi.fn<() => { start: () => void; stop: (msg?: string) => void }>(
    () => ({
      start: vi.fn<() => void>(),
      stop: vi.fn<() => void>(),
    }),
  ),
}));

describe('doctor command', () => {
  it('is defined', () => {
    expect(doctorCommand).toBeDefined();
  });

  it('has correct meta', () => {
    expect((doctorCommand.meta as CommandMeta)?.name).toBe('doctor');
  });

  it('declares --config and --json args', () => {
    const args = doctorCommand.args as ArgsDef;
    expect(args['config']).toMatchObject({ type: 'string' });
    expect(args['json']).toMatchObject({ type: 'boolean' });
  });
});

describe('runDoctor', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'soundor-cli-doctor-'));
    globalThis.__soundorDoctorEvents = [];
  });

  afterEach(async () => {
    delete globalThis.__soundorDoctorEvents;
    await rm(root, { recursive: true, force: true });
  });

  it('reports a healthy project and passes environment + config + runtime checks', async () => {
    await writeConfig(root, [
      { id: 'alpha', checks: [{ label: 'toolchain', status: 'ok' }] },
      {
        id: 'beta',
        checks: [
          {
            label: 'optional tool',
            status: 'warn',
            detail: 'not found',
            suggestion: 'install it',
          },
        ],
      },
    ]);

    const result = await runDoctor({ cwd: root });

    expect(result.status).toBe('warn');
    expect(result.exitCode).toBe(0);

    const categories = new Set(result.diagnostics.map((d) => d.category));
    expect(categories).toEqual(new Set(['environment', 'config', 'runtime']));

    // Suggestion passthrough from a runtime warn check.
    const warn = result.diagnostics.find((d) => d.label === 'optional tool');
    expect(warn).toMatchObject({
      status: 'warn',
      runtime: 'beta',
      suggestion: 'install it',
    });
  });

  it('reports ad-hoc macOS signing by default', async () => {
    await writeConfig(root, []);
    const result = await runDoctor({ cwd: root, env: {} });
    expect(
      result.diagnostics.find((d) => d.label === 'macOS signing'),
    ).toMatchObject({
      category: 'config',
      status: 'ok',
      detail: expect.stringContaining('ad-hoc'),
    });
  });

  it('checks that a named identity is in the keychain on macOS', async () => {
    await writeConfig(root, []);
    const identity = 'Developer ID Application: Acme (ABCDE12345)';
    const probed: string[][] = [];
    const run = (listing: string) =>
      runDoctor({
        cwd: root,
        env: { SOUNDOR_MACOS_SIGNING_IDENTITY: identity },
        platform: 'darwin',
        probe: (cmd, args = []) => {
          probed.push([cmd, ...args]);
          return { ok: true, version: listing };
        },
      });
    const signing = (result: Awaited<ReturnType<typeof runDoctor>>) =>
      result.diagnostics.find((d) => d.label === 'macOS signing');

    expect(
      signing(
        await run(`  1) 0123ABCD "${identity}"\n     1 valid identities found`),
      ),
    ).toMatchObject({
      status: 'ok',
      detail: `'${identity}' (from SOUNDOR_MACOS_SIGNING_IDENTITY).`,
    });
    expect(probed).toContainEqual([
      'security',
      'find-identity',
      '-v',
      '-p',
      'codesigning',
    ]);
    const missing = await run('     0 valid identities found');
    expect(signing(missing)).toMatchObject({ status: 'fail' });
    expect(missing.exitCode).toBe(1);
  });

  it('fails when the identity variable holds key material', async () => {
    await writeConfig(root, []);
    const result = await runDoctor({
      cwd: root,
      env: { SOUNDOR_MACOS_SIGNING_IDENTITY: '-----BEGIN CERTIFICATE-----' },
    });
    expect(
      result.diagnostics.find((d) => d.label === 'macOS signing'),
    ).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('key material'),
    });
  });

  it('delegates to every runtime doctor even when one fails', async () => {
    await writeConfig(root, [
      { id: 'alpha', checks: [{ label: 'a', status: 'ok' }] },
      {
        id: 'beta',
        checks: [
          {
            label: 'missing tool',
            status: 'fail',
            detail: 'CMake not found',
            suggestion: 'Install CMake',
          },
        ],
      },
      { id: 'gamma', checks: [{ label: 'g', status: 'ok' }] },
    ]);

    const result = await runDoctor({ cwd: root });

    expect(globalThis.__soundorDoctorEvents).toEqual([
      'doctor:alpha',
      'doctor:beta',
      'doctor:gamma',
    ]);
    expect(result.status).toBe('fail');
    expect(result.exitCode).toBe(1);

    const failure = result.diagnostics.find((d) => d.status === 'fail');
    expect(failure).toMatchObject({
      runtime: 'beta',
      suggestion: 'Install CMake',
    });
  });

  it('surfaces an invalid config as a failing check and skips runtime checks', async () => {
    // Duplicate runtime ids fail schema validation.
    await writeConfig(root, [
      { id: 'dupe', checks: [] },
      { id: 'dupe', checks: [] },
    ]);

    const result = await runDoctor({ cwd: root });

    expect(result.status).toBe('fail');
    expect(result.exitCode).toBe(1);
    expect(
      result.diagnostics.some(
        (d) => d.category === 'config' && d.status === 'fail',
      ),
    ).toBe(true);
    expect(result.diagnostics.some((d) => d.category === 'runtime')).toBe(
      false,
    );
    for (const failure of result.diagnostics.filter(
      (d) => d.status === 'fail',
    )) {
      expect(failure.suggestion).toBeTruthy();
    }
  });

  it('runs standalone (env only) when no config is present', async () => {
    const result = await runDoctor({ cwd: root });

    expect(result.exitCode).toBe(0);
    expect(result.diagnostics.some((d) => d.category === 'environment')).toBe(
      true,
    );
    expect(result.diagnostics.some((d) => d.category === 'runtime')).toBe(
      false,
    );
    const configDiag = result.diagnostics.find((d) => d.category === 'config');
    expect(configDiag).toMatchObject({ status: 'warn' });
  });

  it('exit code is non-zero iff a check fails', async () => {
    await writeConfig(root, [
      { id: 'ok', checks: [{ label: 'fine', status: 'ok' }] },
    ]);
    await expect(runDoctor({ cwd: root })).resolves.toMatchObject({
      exitCode: 0,
    });

    await writeConfig(root, [
      { id: 'bad', checks: [{ label: 'broken', status: 'fail' }] },
    ]);
    await expect(runDoctor({ cwd: root })).resolves.toMatchObject({
      exitCode: 1,
    });
  });

  it('toJsonReport emits a stable machine-readable shape', async () => {
    await writeConfig(root, [
      { id: 'alpha', checks: [{ label: 'a', status: 'ok' }] },
    ]);

    const report = toJsonReport(await runDoctor({ cwd: root }));

    expect(report).toEqual(
      expect.objectContaining({
        status: expect.any(String),
        exitCode: expect.any(Number),
        checks: expect.any(Array),
      }),
    );
    // Round-trips through JSON.
    expect(() => JSON.parse(JSON.stringify(report))).not.toThrow();
  });

  it('formatDoctorResult renders suggestions for failing checks', async () => {
    await writeConfig(root, [
      {
        id: 'alpha',
        checks: [
          {
            label: 'missing tool',
            status: 'fail',
            detail: 'not found',
            suggestion: 'Install the tool',
          },
        ],
      },
    ]);

    const text = formatDoctorResult(await runDoctor({ cwd: root }));

    expect(text).toContain('missing tool');
    expect(text).toContain('→ Install the tool');
  });
});

interface RuntimeSpec {
  id: string;
  checks: Array<{
    label: string;
    status: 'ok' | 'warn' | 'fail';
    detail?: string;
    suggestion?: string;
  }>;
}

declare global {
  // eslint-disable-next-line no-var
  var __soundorDoctorEvents: string[] | undefined;
}

async function writeConfig(
  root: string,
  runtimes: RuntimeSpec[],
): Promise<void> {
  await writeFile(
    join(root, 'soundor.config.ts'),
    `import { defineSoundorConfig } from '@soundor/config';

function runtime(id, checks) {
  return {
    id,
    async init() {},
    async gen() {},
    async dev() {},
    async build() {},
    async doctor() {
      globalThis.__soundorDoctorEvents.push('doctor:' + id);
      return { checks };
    },
  };
}

export default defineSoundorConfig({
  runtimes: [${runtimes
    .map(
      (spec) =>
        `{ id: ${JSON.stringify(spec.id)}, options: {}, runtime: runtime(${JSON.stringify(spec.id)}, ${JSON.stringify(spec.checks)}) }`,
    )
    .join(', ')}],
  parameters: [],
  plugin: { id: 'com.example.test', name: 'Test' },
});
`,
    'utf8',
  );
}
