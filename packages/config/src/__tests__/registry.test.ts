import {
  createCodegenSink,
  createConsoleLogger,
  RuntimeError,
  UnknownRuntimeError,
  type FileSystemHost,
} from '@soundor/core';
import { describe, expect, it } from 'vitest';

import type { DispatchContextInput } from '../registry';
import { resolveRuntime, runPhase } from '../registry';
import type { DoctorReport, Runtime, RuntimeDescriptor } from '../runtime';
import type { SoundorConfig } from '../types';

const noopFs: FileSystemHost = {
  resolve: (...s) => s.join('/'),
  exists: async () => false,
  read: async () => '',
  write: async () => {},
  mkdir: async () => {},
  rm: async () => {},
  readdir: async () => [],
};

function dispatchInput(
  overrides: Partial<DispatchContextInput> = {},
): DispatchContextInput {
  return {
    paths: {
      root: '/p',
      config: '/p/soundor.config.ts',
      dist: '/p/.soundor/dist/x',
      gen: '/p/.soundor/gen/x',
      cache: '/p/.soundor/cache/x',
    },
    logger: createConsoleLogger(),
    fs: noopFs,
    codegen: createCodegenSink(),
    ...overrides,
  };
}

function descriptor(
  id: string,
  runtime: Runtime,
  options: Record<string, unknown> = {},
): RuntimeDescriptor {
  return { id, options, runtime };
}

function config(...runtimes: RuntimeDescriptor[]): SoundorConfig {
  return { runtimes, parameters: [], nativeMethods: [] };
}

describe('resolveRuntime', () => {
  const juce: Runtime = {
    id: 'juce',
    init: async () => {},
    gen: async () => {},
    dev: async () => {},
    build: async () => {},
    doctor: async () => ({ checks: [] }),
  };

  it('returns the runtime and its config entry for a known id', () => {
    const cfg = config(descriptor('juce', juce, { format: 'vst3' }));
    const resolved = resolveRuntime(cfg, 'juce');
    expect(resolved.runtime).toBe(juce);
    expect(resolved.config).toEqual({
      id: 'juce',
      options: { format: 'vst3' },
    });
  });

  it('throws UnknownRuntimeError listing available ids', () => {
    const cfg = config(descriptor('juce', juce));
    let caught: unknown;
    try {
      resolveRuntime(cfg, 'au');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnknownRuntimeError);
    expect((caught as UnknownRuntimeError).available).toEqual(['juce']);
  });
});

describe('runPhase', () => {
  it('dispatches by phase and threads options + mode into the context', async () => {
    const seen: Array<{ phase: string; mode: string; options: unknown }> = [];
    const runtime: Runtime = {
      id: 'juce',
      init: async (_c, ctx) => {
        seen.push({ phase: ctx.phase, mode: ctx.mode, options: ctx.options });
      },
      gen: async () => {},
      dev: async () => {},
      build: async (_c, ctx) => {
        seen.push({ phase: ctx.phase, mode: ctx.mode, options: ctx.options });
      },
      doctor: async (): Promise<DoctorReport> => ({
        checks: [{ label: 'ok', status: 'ok' }],
      }),
    };
    const cfg = config(descriptor('juce', runtime, { format: 'vst3' }));
    const resolved = resolveRuntime(cfg, 'juce');

    await runPhase(resolved, 'init', cfg, dispatchInput());
    await runPhase(
      resolved,
      'build',
      cfg,
      dispatchInput({ mode: 'production' }),
    );
    const report = await runPhase(resolved, 'doctor', cfg, dispatchInput());

    expect(seen).toEqual([
      { phase: 'init', mode: 'debug', options: { format: 'vst3' } },
      { phase: 'build', mode: 'production', options: { format: 'vst3' } },
    ]);
    expect(report).toEqual({ checks: [{ label: 'ok', status: 'ok' }] });
  });

  it('wraps a thrown error as RuntimeError tagged with id and phase', async () => {
    const boom = new Error('kaboom');
    const runtime: Runtime = {
      id: 'juce',
      init: async () => {},
      gen: async () => {},
      dev: async () => {
        throw boom;
      },
      build: async () => {},
      doctor: async () => ({ checks: [] }),
    };
    const cfg = config(descriptor('juce', runtime));
    const resolved = resolveRuntime(cfg, 'juce');

    const err = (await runPhase(resolved, 'dev', cfg, dispatchInput()).catch(
      (error: unknown) => error,
    )) as RuntimeError;
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.runtimeId).toBe('juce');
    expect(err.phase).toBe('dev');
    expect(err.cause).toBe(boom);
  });

  it('passes an already-typed SoundorError through unwrapped', async () => {
    const original = new RuntimeError('explicit', { runtimeId: 'juce' });
    const runtime: Runtime = {
      id: 'juce',
      init: async () => {
        throw original;
      },
      gen: async () => {},
      dev: async () => {},
      build: async () => {},
      doctor: async () => ({ checks: [] }),
    };
    const cfg = config(descriptor('juce', runtime));
    const resolved = resolveRuntime(cfg, 'juce');
    await expect(runPhase(resolved, 'init', cfg, dispatchInput())).rejects.toBe(
      original,
    );
  });

  it('provides a default abort signal when none is passed', async () => {
    const signals: AbortSignal[] = [];
    const runtime: Runtime = {
      id: 'juce',
      init: async (_c, ctx) => {
        signals.push(ctx.signal);
      },
      gen: async () => {},
      dev: async () => {},
      build: async () => {},
      doctor: async () => ({ checks: [] }),
    };
    const cfg = config(descriptor('juce', runtime));
    const resolved = resolveRuntime(cfg, 'juce');
    await runPhase(resolved, 'init', cfg, dispatchInput());
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(false);
  });
});
