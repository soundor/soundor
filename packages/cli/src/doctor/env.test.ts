import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runEnvironmentChecks } from './env';

const probeCommand = vi.hoisted(() =>
  vi.fn<(command: string) => { ok: boolean; version?: string }>(),
);
vi.mock('@soundor/core', () => ({ probeCommand }));

const installed = (...names: string[]) =>
  probeCommand.mockImplementation((command) =>
    names.includes(command) ? { ok: true, version: '1.0.0' } : { ok: false },
  );
const packageManagerCheck = () =>
  runEnvironmentChecks().find((check) => check.label === 'Package manager')!;

describe('the package manager check', () => {
  const original = process.env['npm_config_user_agent'];
  beforeEach(() => {
    delete process.env['npm_config_user_agent'];
  });
  afterEach(() => {
    probeCommand.mockReset();
    if (original === undefined) delete process.env['npm_config_user_agent'];
    else process.env['npm_config_user_agent'] = original;
  });

  it('prefers pnpm, then npm', () => {
    installed('pnpm', 'npm');
    expect(packageManagerCheck()).toMatchObject({
      status: 'ok',
      detail: 'pnpm 1.0.0.',
    });
    installed('npm');
    expect(packageManagerCheck().detail).toBe('npm 1.0.0.');
  });

  it('reports the supported one it runs under first', () => {
    process.env['npm_config_user_agent'] = 'npm/11.0.0 node/v24.0.0';
    installed('pnpm', 'npm');
    expect(packageManagerCheck().detail).toBe('npm 1.0.0.');
  });

  it('warns when run under one Soundor does not support', () => {
    for (const agent of ['yarn/4.5.0 npm/? node/v24.0.0', 'bun/1.2.0']) {
      process.env['npm_config_user_agent'] = agent;
      installed('pnpm', 'yarn', 'bun');
      const check = packageManagerCheck();
      expect(check.status).toBe('warn');
      expect(check.detail).toContain('does not support');
      expect(check.suggestion).toBe('Use pnpm or npm for Soundor projects.');
    }
  });

  it('fails without pnpm or npm, whatever else is installed', () => {
    installed('yarn', 'bun');
    expect(packageManagerCheck()).toMatchObject({
      status: 'fail',
      detail: 'No supported package manager found (looked for pnpm, npm).',
    });
  });
});
