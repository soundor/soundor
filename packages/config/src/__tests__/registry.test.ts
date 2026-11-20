import {
  createCodegenSink,
  createConsoleLogger,
  RuntimeError,
  UnknownRuntimeError,
  type FileSystemHost,
} from '@soundor/core';
import { describe, expect, it } from 'vitest';

import { resolveEditor } from '../editor';
import type { DispatchContextInput } from '../registry';
import { resolveRuntime, runPhase } from '../registry';
import type { DoctorReport, Runtime, RuntimeDescriptor } from '../runtime';
import type { ResolvedSoundorConfig } from '../types';

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
      state: '/p/.soundor/state/x',
    },
    logger: createConsoleLogger(),
    fs: noopFs,
    codegen: createCodegenSink(),
    env: {},
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

function config(...runtimes: RuntimeDescriptor[]): ResolvedSoundorConfig {
  return {
    plugin: { id: 'com.example.test', name: 'Test' },
    editor: resolveEditor(undefined),
    runtimes,
    parameters: [],
    native: {},
    signing: {},
  };
}

describe('resolveRuntime', () => {
  const vst3: Runtime = {
    id: 'vst3',
    gen: async () => {},
    dev: async () => {},
    build: async () => {},
    doctor: async () => ({ checks: [] }),
  };

  it('returns the runtime and its config entry for a known id', () => {
    const cfg = config(descriptor('vst3', vst3, { format: 'vst3' }));
    const resolved = resolveRuntime(cfg, 'vst3');
    expect(resolved.runtime).toBe(vst3);
    expect(resolved.config).toEqual({
      id: 'vst3',
      options: { format: 'vst3' },
    });
  });

  it('throws UnknownRuntimeError listing available ids', () => {
    const cfg = config(descriptor('vst3', vst3));
    let caught: unknown;
    try {
      resolveRuntime(cfg, 'au');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnknownRuntimeError);
    expect((caught as UnknownRuntimeError).available).toEqual(['vst3']);
  });
});

describe('runPhase', () => {
  it('provides credentials only to supported debug development lifecycles', async () => {
    const seen: unknown[] = [];
    const record: Runtime['dev'] = async (_config, ctx) => {
      seen.push(ctx.devtools);
    };
    const runtime: Runtime = {
      id: 'custom',
      capabilities: { devtools: {} },
      gen: record,
      dev: record,
      build: record,
      doctor: async () => ({ checks: [] }),
    };
    const cfg = config(descriptor('custom', runtime));
    const resolved = resolveRuntime(cfg, 'custom');
    const devtools = {
      endpoint: 'local-endpoint',
      sessionId: 'session',
      token: 'secret',
    };
    for (const phase of ['gen', 'dev', 'build'] as const) {
      await runPhase(resolved, phase, cfg, dispatchInput({ devtools }));
    }
    await runPhase(
      resolved,
      'dev',
      cfg,
      dispatchInput({ devtools, mode: 'production' }),
    );
    await runPhase(
      { ...resolved, runtime: { ...runtime, capabilities: undefined } },
      'dev',
      cfg,
      dispatchInput({ devtools }),
    );
    expect(seen).toEqual([
      undefined,
      devtools,
      undefined,
      undefined,
      undefined,
    ]);
  });
  it('dispatches by phase and threads options + mode into the context', async () => {
    const seen: Array<{ phase: string; mode: string; options: unknown }> = [];
    const runtime: Runtime = {
      id: 'vst3',
      gen: async (_c, ctx) => {
        seen.push({ phase: ctx.phase, mode: ctx.mode, options: ctx.options });
      },
      dev: async () => {},
      build: async (_c, ctx) => {
        seen.push({ phase: ctx.phase, mode: ctx.mode, options: ctx.options });
      },
      doctor: async (): Promise<DoctorReport> => ({
        checks: [{ label: 'ok', status: 'ok' }],
      }),
    };
    const cfg = config(descriptor('vst3', runtime, { format: 'vst3' }));
    const resolved = resolveRuntime(cfg, 'vst3');

    await runPhase(resolved, 'gen', cfg, dispatchInput());
    await runPhase(
      resolved,
      'build',
      cfg,
      dispatchInput({ mode: 'production' }),
    );
    const report = await runPhase(resolved, 'doctor', cfg, dispatchInput());

    expect(seen).toEqual([
      { phase: 'gen', mode: 'debug', options: { format: 'vst3' } },
      { phase: 'build', mode: 'production', options: { format: 'vst3' } },
    ]);
    expect(report).toEqual({ checks: [{ label: 'ok', status: 'ok' }] });
  });

  it('resolves signing from the environment and the config', async () => {
    const seen: unknown[] = [];
    const runtime: Runtime = {
      id: 'vst3',
      gen: async () => {},
      dev: async () => {},
      build: async (_c, ctx) => {
        seen.push(ctx.signing);
      },
      doctor: async () => ({ checks: [] }),
    };
    const cfg: ResolvedSoundorConfig = {
      ...config(descriptor('vst3', runtime)),
      signing: { macos: { identity: 'Apple Development: Me (TEAM)' } },
    };
    const resolved = resolveRuntime(cfg, 'vst3');

    await runPhase(resolved, 'build', cfg, dispatchInput());
    await runPhase(
      resolved,
      'build',
      cfg,
      dispatchInput({
        env: {
          SOUNDOR_MACOS_SIGNING_IDENTITY:
            'Developer ID Application: Acme (ABCDE12345)',
        },
      }),
    );

    expect(seen).toEqual([
      { macos: { identity: 'Apple Development: Me (TEAM)', source: 'config' } },
      {
        macos: {
          identity: 'Developer ID Application: Acme (ABCDE12345)',
          source: 'env',
        },
      },
    ]);
  });

  it('wraps a thrown error as RuntimeError tagged with id and phase', async () => {
    const boom = new Error('kaboom');
    const runtime: Runtime = {
      id: 'vst3',
      gen: async () => {},
      dev: async () => {
        throw boom;
      },
      build: async () => {},
      doctor: async () => ({ checks: [] }),
    };
    const cfg = config(descriptor('vst3', runtime));
    const resolved = resolveRuntime(cfg, 'vst3');

    const err = (await runPhase(resolved, 'dev', cfg, dispatchInput()).catch(
      (error: unknown) => error,
    )) as RuntimeError;
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.runtimeId).toBe('vst3');
    expect(err.phase).toBe('dev');
    expect(err.cause).toBe(boom);
  });

  it('passes an already-typed SoundorError through unwrapped', async () => {
    const original = new RuntimeError('explicit', { runtimeId: 'vst3' });
    const runtime: Runtime = {
      id: 'vst3',
      gen: async () => {
        throw original;
      },
      dev: async () => {},
      build: async () => {},
      doctor: async () => ({ checks: [] }),
    };
    const cfg = config(descriptor('vst3', runtime));
    const resolved = resolveRuntime(cfg, 'vst3');
    await expect(runPhase(resolved, 'gen', cfg, dispatchInput())).rejects.toBe(
      original,
    );
  });

  it('provides a default abort signal when none is passed', async () => {
    const signals: AbortSignal[] = [];
    const runtime: Runtime = {
      id: 'vst3',
      gen: async (_c, ctx) => {
        signals.push(ctx.signal);
      },
      dev: async () => {},
      build: async () => {},
      doctor: async () => ({ checks: [] }),
    };
    const cfg = config(descriptor('vst3', runtime));
    const resolved = resolveRuntime(cfg, 'vst3');
    await runPhase(resolved, 'gen', cfg, dispatchInput());
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(false);
  });
});
