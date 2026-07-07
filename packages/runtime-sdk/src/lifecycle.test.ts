import { describe, expect, it } from 'vitest';

import {
  createCodegenSink,
  defineRuntime,
  resolveRuntime,
  runPhase,
  RuntimeError,
  type CollectingCodegenSink,
  type DispatchContextInput,
  type DoctorReport,
  type FileSystemHost,
  type Logger,
  type RuntimePhase,
  type SoundorConfig,
} from './index';

/** An in-memory FileSystemHost backed by a Map. */
function memoryFs(): FileSystemHost & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    resolve: (...segments) => segments.join('/'),
    exists: async (path) => store.has(path),
    read: async (path) => store.get(path) ?? '',
    write: async (path, contents) => {
      store.set(path, contents);
    },
    mkdir: async () => {},
    rm: async (path) => {
      store.delete(path);
    },
    readdir: async () => [...store.keys()],
  };
}

/** A Logger that records every call as `level:message`. */
function recordingLogger(records: string[]): Logger {
  const make = (scope?: string): Logger => {
    const prefix = scope ? `${scope} ` : '';
    const log =
      (level: string) =>
      (message: string): void => {
        records.push(`${level}:${prefix}${message}`);
      };
    return {
      debug: log('debug'),
      info: log('info'),
      warn: log('warn'),
      error: log('error'),
      child: (childScope) =>
        make(scope ? `${scope}:${childScope}` : childScope),
    };
  };
  return make();
}

const PHASES: RuntimePhase[] = ['init', 'gen', 'dev', 'build', 'doctor'];

describe('runtime lifecycle', () => {
  it('drives a fake runtime through all five phases via the SDK', async () => {
    const calls: RuntimePhase[] = [];
    const seenOptions: unknown[] = [];

    const juceRuntime = defineRuntime<{ format: string }>({
      id: 'juce',
      init: async (_config, ctx) => {
        calls.push('init');
        seenOptions.push(ctx.options);
        await ctx.fs.write('init.txt', 'ready');
        ctx.logger.info('initialized');
      },
      gen: async (_config, ctx) => {
        calls.push('gen');
        ctx.codegen.emit({ path: 'params.ts', contents: '// generated' });
      },
      dev: async (_config, ctx) => {
        calls.push('dev');
        expect(ctx.mode).toBe('debug');
      },
      build: async (_config, ctx) => {
        calls.push('build');
        expect(ctx.mode).toBe('production');
      },
      doctor: async (): Promise<DoctorReport> => {
        calls.push('doctor');
        return { checks: [{ label: 'toolchain', status: 'ok' }] };
      },
    });

    const config: SoundorConfig = {
      runtimes: [juceRuntime({ format: 'vst3' })],
      parameters: [],
      nativeMethods: [],
    };

    const fs = memoryFs();
    const codegen: CollectingCodegenSink = createCodegenSink();
    const logs: string[] = [];
    const baseInput: Omit<DispatchContextInput, 'mode'> = {
      paths: {
        root: '/p',
        config: '/p/soundor.config.ts',
        dist: '/p/.soundor/dist/juce',
        gen: '/p/.soundor/gen/juce',
        cache: '/p/.soundor/cache/juce',
      },
      logger: recordingLogger(logs),
      fs,
      codegen,
    };

    const resolved = resolveRuntime(config, 'juce');
    let report: DoctorReport | undefined;
    for (const phase of PHASES) {
      const mode = phase === 'build' ? 'production' : 'debug';
      const result = await runPhase(resolved, phase, config, {
        ...baseInput,
        mode,
      });
      if (phase === 'doctor') report = result as DoctorReport;
    }

    // Selection is by phase string alone — every phase ran, in order.
    expect(calls).toEqual(['init', 'gen', 'dev', 'build', 'doctor']);
    // Options from the resolved config entry reached the runtime.
    expect(seenOptions).toEqual([{ format: 'vst3' }]);
    // Side effects went through the injected host seams.
    expect(fs.store.get('init.txt')).toBe('ready');
    expect(codegen.files()).toEqual([
      { path: 'params.ts', contents: '// generated' },
    ]);
    expect(logs).toContain('info:initialized');
    // doctor's report is returned.
    expect(report).toEqual({ checks: [{ label: 'toolchain', status: 'ok' }] });
  });

  it('surfaces a throwing phase as a RuntimeError tagged with id and phase', async () => {
    const boom = new Error('build blew up');
    const runtime = defineRuntime({
      id: 'juce',
      init: async () => {},
      gen: async () => {},
      dev: async () => {},
      build: async () => {
        throw boom;
      },
      doctor: async () => ({ checks: [] }),
    });
    const config: SoundorConfig = {
      runtimes: [runtime()],
      parameters: [],
      nativeMethods: [],
    };
    const resolved = resolveRuntime(config, 'juce');
    const input: DispatchContextInput = {
      paths: {
        root: '/p',
        config: '/p/soundor.config.ts',
        dist: '/p/d',
        gen: '/p/g',
        cache: '/p/c',
      },
      logger: recordingLogger([]),
      fs: memoryFs(),
      codegen: createCodegenSink(),
    };

    const err = (await runPhase(resolved, 'build', config, input).catch(
      (error: unknown) => error,
    )) as RuntimeError;
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.runtimeId).toBe('juce');
    expect(err.phase).toBe('build');
    expect(err.cause).toBe(boom);
    expect(err.exitCode).toBe(5);
  });
});
