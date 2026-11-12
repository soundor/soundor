import { describe, expect, it } from 'vitest';

import {
  EnvError,
  EXIT_CODES,
  RuntimeError,
  SoundorError,
  UnknownRuntimeError,
  exitCodeFor,
  isSoundorError,
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
      RUNTIME: 5,
      INTERNAL: 70,
      TRANSACTION_ABORTED: 5,
    });
  });
});

describe('isSoundorError', () => {
  it('recognizes every subclass, and filters by code', () => {
    expect(isSoundorError(new EnvError('x'))).toBe(true);
    expect(isSoundorError(new EnvError('x'), 'ENV')).toBe(true);
    expect(isSoundorError(new EnvError('x'), 'RUNTIME')).toBe(false);
    expect(isSoundorError(new UnknownRuntimeError('juce'))).toBe(true);
  });

  it('rejects look-alikes without the brand', () => {
    expect(isSoundorError(new Error('x'))).toBe(false);
    expect(isSoundorError({ code: 'ENV', message: 'x', issues: [] })).toBe(
      false,
    );
    expect(isSoundorError(null)).toBe(false);
    expect(isSoundorError('ENV')).toBe(false);
  });

  it('recognizes an error of another copy by its protocol', () => {
    // What another copy's SoundorError is to this one: a different class with
    // the same global brand. (The packages' integration tests load real
    // separate copies.)
    class ForeignError extends Error {
      readonly code = 'ENV';
      readonly issues = [];
      get [Symbol.for('soundor.error.v1')](): true {
        return true;
      }
    }
    const foreign = new ForeignError('missing cmake');
    expect(foreign instanceof SoundorError).toBe(false);
    expect(isSoundorError(foreign, 'ENV')).toBe(true);
    expect(exitCodeFor(foreign)).toBe(EXIT_CODES.ENV);
  });

  it('maps a code this copy does not know to INTERNAL', () => {
    const newer = Object.assign(new Error('from a newer core'), {
      code: 'SOMETHING_NEW',
      issues: [],
      [Symbol.for('soundor.error.v1')]: true,
    });
    expect(isSoundorError(newer)).toBe(true);
    expect(exitCodeFor(newer)).toBe(EXIT_CODES.INTERNAL);
  });
});
