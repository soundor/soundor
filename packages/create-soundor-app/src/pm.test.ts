import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectPackageManager, runScript } from './pm';

describe('detectPackageManager', () => {
  const original = process.env['npm_config_user_agent'];

  beforeEach(() => {
    delete process.env['npm_config_user_agent'];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env['npm_config_user_agent'];
    } else {
      process.env['npm_config_user_agent'] = original;
    }
  });

  it('returns undefined when env var is absent', () => {
    expect(detectPackageManager()).toBeUndefined();
  });

  it('detects pnpm', () => {
    process.env['npm_config_user_agent'] = 'pnpm/8.0.0 npm/? node/v22.0.0';
    expect(detectPackageManager()).toBe('pnpm');
  });

  it('detects npm', () => {
    process.env['npm_config_user_agent'] = 'npm/10.0.0 node/v22.0.0';
    expect(detectPackageManager()).toBe('npm');
  });

  it('does not detect the package managers Soundor does not support', () => {
    for (const agent of [
      'yarn/4.0.0 npm/? node/v22.0.0',
      'yarn/1.22.22 npm/? node/v22.0.0',
      'bun/1.0.0',
    ]) {
      process.env['npm_config_user_agent'] = agent;
      expect(detectPackageManager()).toBeUndefined();
    }
  });

  it('returns undefined for unrecognised agent string', () => {
    process.env['npm_config_user_agent'] = 'someothertool/1.0.0';
    expect(detectPackageManager()).toBeUndefined();
  });
});

describe('runScript', () => {
  it('runs a script the way each package manager needs', () => {
    expect(runScript('pnpm', 'dev')).toBe('pnpm dev');
    expect(runScript('npm', 'dev')).toBe('npm run dev');
  });
});
