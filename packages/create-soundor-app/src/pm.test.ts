import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectPackageManager } from './pm';

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

  it('detects yarn', () => {
    process.env['npm_config_user_agent'] = 'yarn/4.0.0 npm/? node/v22.0.0';
    expect(detectPackageManager()).toBe('yarn');
  });

  it('detects npm', () => {
    process.env['npm_config_user_agent'] = 'npm/10.0.0 node/v22.0.0';
    expect(detectPackageManager()).toBe('npm');
  });

  it('detects bun', () => {
    process.env['npm_config_user_agent'] = 'bun/1.0.0';
    expect(detectPackageManager()).toBe('bun');
  });

  it('returns undefined for unrecognised agent string', () => {
    process.env['npm_config_user_agent'] = 'someothertool/1.0.0';
    expect(detectPackageManager()).toBeUndefined();
  });
});
