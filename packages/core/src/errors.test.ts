import { describe, expect, it } from 'vitest';

import {
  EnvError,
  EXIT_CODES,
  RuntimeError,
  SoundorError,
  UnknownRuntimeError,
  exitCodeFor,
} from './errors';

describe('SoundorError', () => {
  it('carries code, issues, and a derived exit code', () => {
    const err = new SoundorError('boom', {
      code: 'CONFIG',
      issues: [{ path: 'runtimes[0].id', message: 'bad' }],
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SoundorError');
    expect(err.code).toBe('CONFIG');
    expect(err.exitCode).toBe(EXIT_CODES.CONFIG);
    expect(err.issues).toHaveLength(1);
  });

  it('defaults issues to empty and forwards cause', () => {
    const cause = new Error('root');
    const err = new SoundorError('boom', { code: 'INTERNAL', cause });
    expect(err.issues).toEqual([]);
    expect(err.cause).toBe(cause);
  });
});

describe('SoundorError subclasses', () => {
  it('RuntimeError has RUNTIME code and tags', () => {
    const err = new RuntimeError('phase failed', {
      runtimeId: 'juce',
      phase: 'build',
    });
    expect(err).toBeInstanceOf(SoundorError);
    expect(err.name).toBe('RuntimeError');
    expect(err.code).toBe('RUNTIME');
    expect(err.exitCode).toBe(5);
    expect(err.runtimeId).toBe('juce');
    expect(err.phase).toBe('build');
  });

  it('UnknownRuntimeError lists available ids', () => {
    const err = new UnknownRuntimeError('vst', ['juce', 'au']);
    expect(err.code).toBe('UNKNOWN_RUNTIME');
    expect(err.exitCode).toBe(4);
    expect(err.runtimeId).toBe('vst');
    expect(err.available).toEqual(['juce', 'au']);
    expect(err.message).toContain('juce, au');
  });

  it('EnvError has ENV code', () => {
    const err = new EnvError('missing toolchain');
    expect(err.code).toBe('ENV');
    expect(err.exitCode).toBe(3);
  });
});

describe('exitCodeFor', () => {
  it('maps a SoundorError to its exit code', () => {
    expect(exitCodeFor(new EnvError('x'))).toBe(3);
    expect(exitCodeFor(new UnknownRuntimeError('x'))).toBe(4);
  });

  it('classifies a subclass with a CONFIG code as 2', () => {
    class ConfigError extends SoundorError {
      constructor() {
        super('bad config', { code: 'CONFIG' });
      }
    }
    expect(exitCodeFor(new ConfigError())).toBe(2);
  });

  it('maps anything else to INTERNAL (70)', () => {
    expect(exitCodeFor(new Error('plain'))).toBe(70);
    expect(exitCodeFor('nope')).toBe(70);
    expect(exitCodeFor(undefined)).toBe(70);
  });
});

describe('EXIT_CODES', () => {
  it('is stable', () => {
    expect(EXIT_CODES).toEqual({
      CONFIG: 2,
      ENV: 3,
      UNKNOWN_RUNTIME: 4,
      INVALID_RUNTIME: 4,
      RUNTIME: 5,
      INTERNAL: 70,
    });
  });
});
