import { describe, expect, it } from 'vitest';

import { SoundorError } from './index';
import type { BuildOptions, Runtime } from './index';

describe('SoundorError', () => {
  it('is an instance of Error', () => {
    const err = new SoundorError('something failed');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SoundorError);
  });

  it('preserves the message', () => {
    const err = new SoundorError('something failed');
    expect(err.message).toBe('something failed');
  });

  it('has the correct name', () => {
    const err = new SoundorError('oops');
    expect(err.name).toBe('SoundorError');
  });
});

describe('Runtime interface', () => {
  it('accepts a conforming implementation', () => {
    const runtime: Runtime = {
      dev: async () => {},
      build: async () => {},
    };
    expect(runtime).toBeDefined();
  });
});

describe('BuildOptions', () => {
  it('accepts debug mode', () => {
    const opts: BuildOptions = { mode: 'debug' };
    expect(opts.mode).toBe('debug');
  });

  it('accepts production mode', () => {
    const opts: BuildOptions = { mode: 'production' };
    expect(opts.mode).toBe('production');
  });
});
