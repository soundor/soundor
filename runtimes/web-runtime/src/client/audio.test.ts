import type {
  ProcessorNode,
  ProcessorNodeOptions,
} from '@soundor/engine/web/processor';
import { describeState, StateStore } from '@soundor/runtime-sdk/client';
import { describe, expect, it, vi } from 'vitest';

import {
  plainValue,
  WebAudioHost,
  type WebAudioHostOptions,
  type WebAudioInputContext,
  type WebProcessorSource,
} from './audio';
import { processorState } from './audio-state';
import { WebHost } from './host';

// The engine's processor host, as the page would import it: whether the host
// loaded it, and what it made.
const engineProcessor = vi.hoisted(() => ({
  loaded: false,
  create: undefined as
    | ((
        context: BaseAudioContext,
        options: ProcessorNodeOptions,
      ) => Promise<ProcessorNode>)
    | undefined,
}));
vi.mock('@soundor/engine/web/processor', () => {
  engineProcessor.loaded = true;
  return {
    createProcessorNode: (
      context: BaseAudioContext,
      options: ProcessorNodeOptions,
    ) => engineProcessor.create?.(context, options),
  };
});

/** A Web Audio node that records what it is connected to. */
class FakeNode {
  readonly connections = new Set<FakeNode>();
  constructor(readonly kind: string) {}
  connect(target: FakeNode): FakeNode {
    this.connections.add(target);
    return target;
  }
  disconnect(target?: FakeNode): void {
    if (target === undefined) this.connections.clear();
    else this.connections.delete(target);
  }
}

class FakeParam {
  value = 1;
  setTargetAtTime(value: number): void {
    this.value = value;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
  constructor() {
    super('gain');
  }
}

class FakeSource extends FakeNode {
  started: number[] | null = null;
  stopped = false;
  loop = false;
  buffer: unknown = null;
  type = '';
  onended: (() => void) | null = null;
  readonly frequency = new FakeParam();
  start(...args: number[]): void {
    this.started = args;
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeContext {
  readonly sampleRate = 44100;
  currentTime = 0;
  state = 'suspended';
  readonly destination = new FakeNode('destination');
  readonly sources: FakeSource[] = [];
  readonly mediaSources: FakeNode[] = [];
  closed = false;
  resume = vi.fn<() => Promise<void>>(async () => {
    this.state = 'running';
  });
  createGain(): FakeGain {
    return new FakeGain();
  }
  createOscillator(): FakeSource {
    const source = new FakeSource('oscillator');
    this.sources.push(source);
    return source;
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource('buffer');
    this.sources.push(source);
    return source;
  }
  createMediaStreamSource(): FakeNode {
    const node = new FakeNode('microphone');
    this.mediaSources.push(node);
    return node;
  }
  async decodeAudioData(): Promise<{ duration: number }> {
    return { duration: 4 };
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

/** A processor node that records what the host gives it. */
function fakeProcessor(ready: Promise<void> = Promise.resolve()) {
  const created: { options?: ProcessorNodeOptions } = {};
  const node = new FakeNode('processor');
  const processor = {
    node: node as unknown as AudioWorkletNode,
    ready,
    sendMidi: vi.fn<ProcessorNode['sendMidi']>(() => 'sent'),
    observeMidi: vi.fn<ProcessorNode['observeMidi']>(),
    setParameters: vi.fn<(values: readonly number[]) => void>(),
    setTransport: vi.fn<(values: readonly number[]) => void>(),
    publishResource: vi.fn<(index: number, bytes: Uint8Array) => void>(),
    setState: vi.fn<(snapshot: Uint8Array) => void>(),
    reset: vi.fn<() => void>(),
    dispose: vi.fn<() => void>(),
  } satisfies ProcessorNode;
  const create = vi.fn<
    (
      _: BaseAudioContext,
      options: ProcessorNodeOptions,
    ) => Promise<ProcessorNode>
  >(async (_: BaseAudioContext, options: ProcessorNodeOptions) => {
    created.options = options;
    return processor;
  });
  return { node, processor, created, create };
}

function setup(
  loadProcessor?: () => Promise<WebProcessorSource | undefined>,
  options: Omit<WebAudioHostOptions, 'loadProcessor' | 'createContext'> = {},
) {
  let now = 0;
  const frames = { request: () => 1, cancel: () => {} };
  const host = new WebHost({ now: () => now, frames });
  const context = new FakeContext();
  const createContext = vi.fn<() => AudioContext>(
    () => context as unknown as AudioContext,
  );
  const audio = new WebAudioHost(host, {
    ...options,
    loadProcessor,
    createContext,
  });
  return {
    host,
    audio,
    context,
    createContext,
    advance: (ms: number) => (now += ms),
  };
}

/** Whether `from` reaches `to` through connections. */
function reaches(from: FakeNode, to: FakeNode): boolean {
  if (from === to) return true;
  return [...from.connections].some((next) => reaches(next, to));
}

describe('WebAudioHost', () => {
  it('creates no AudioContext until started (autoplay rules)', () => {
    const { audio, createContext } = setup();
    expect(createContext).not.toHaveBeenCalled();
    expect(audio.status.state).toBe('off');
  });

  it('starts once, resuming the context, and reports the format', async () => {
    const { audio, host, context, createContext } = setup();
    await Promise.all([audio.start(), audio.start()]);
    expect(createContext).toHaveBeenCalledOnce();
    expect(context.resume).toHaveBeenCalled();
    expect(audio.status).toMatchObject({ state: 'running', sampleRate: 44100 });
    expect(host.snapshot()).toMatchObject({
      sampleRate: 44100,
      blockSize: 128,
    });
    await audio.start();
    expect(createContext).toHaveBeenCalledOnce();
  });

  it('passes the input through when the project has no audio setup', async () => {
    const { audio, host, context } = setup();
    await audio.start();
    host.play();
    const oscillator = context.sources[0]!;
    expect(oscillator.kind).toBe('oscillator');
    expect(oscillator.started).not.toBeNull();
    expect(reaches(oscillator, context.destination)).toBe(true);
  });

  it("loads the engine's processor host only for a processor, once audio starts", async () => {
    const { audio, host } = setup();
    await audio.start();
    host.play();
    expect(engineProcessor.loaded).toBe(false);

    const fake = fakeProcessor();
    engineProcessor.create = fake.create;
    const withProcessor = setup(async () => ({
      wasm: new Uint8Array([0, 97, 115, 109]),
      parameters: [],
      streams: [],
      publishStream: () => {},
    }));
    expect(engineProcessor.loaded).toBe(false);
    await withProcessor.audio.start();
    expect(engineProcessor.loaded).toBe(true);
    expect(fake.create).toHaveBeenCalledOnce();
    withProcessor.audio.dispose();
    expect(fake.processor.dispose).toHaveBeenCalledOnce();
  });

  it("puts the plugin's processor between input and output, and cleans up", async () => {
    const fake = fakeProcessor();
    const source = {
      wasm: new Uint8Array([0, 97, 115, 109]),
      parameters: [],
      streams: [],
      publishStream: () => {},
    };
    const { audio, host, context } = setup(async () => source, {
      audio: { inputChannels: 1, outputChannels: 2 },
      createProcessorNode: fake.create,
    });
    await audio.start();
    host.play();
    const oscillator = context.sources[0]!;
    expect(reaches(oscillator, fake.node)).toBe(true);
    expect(reaches(fake.node, context.destination)).toBe(true);
    expect(fake.created.options).toMatchObject({
      wasm: source.wasm,
      inputs: [1],
      outputs: [2],
      contract: { parameters: 0, published: 0, streams: 0 },
    });
    expect(fake.processor.setTransport).toHaveBeenCalled();

    audio.dispose();
    expect(fake.processor.dispose).toHaveBeenCalledOnce();
    expect(oscillator.stopped).toBe(true);
    expect(context.closed).toBe(true);
  });

  it('gives the processor plain values, and publishes what it publishes', async () => {
    const { storeOf } = await import('./testing/store');
    const { list, byId } = storeOf({
      gain: { type: 'float32', label: 'Gain', min: 0, max: 1, default: 0.5 },
      bypass: { type: 'boolean', label: 'Bypass', default: true },
      mode: {
        type: 'choice',
        label: 'Mode',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        default: 'b',
      },
      meter: {
        type: 'float32',
        label: 'Meter',
        min: -60,
        max: 0,
        default: -60,
        access: 'readOnly',
      },
    });
    const published: [number, unknown][] = [];
    const fake = fakeProcessor();
    const { audio } = setup(
      async () => ({
        wasm: new Uint8Array(),
        parameters: list,
        streams: [{ name: 'level', kind: 'number', element: 'float32' }],
        publishStream: (index, value) => published.push([index, value]),
      }),
      { createProcessorNode: fake.create },
    );
    await audio.start();
    expect(fake.created.options?.parameters).toEqual([0.5, 1, 1, -60]);
    expect(fake.created.options?.contract).toEqual({
      midi: true,
      parameters: 4,
      published: 1,
      streams: 1,
      state: 0,
    });
    expect(list.map(plainValue)).toEqual([0.5, 1, 1, -60]);
    // Once ready, the values again: one may have moved while it loaded.
    expect(fake.processor.setParameters).toHaveBeenCalledWith([0.5, 1, 1, -60]);
    byId['gain']!.set(0.25);
    expect(fake.processor.setParameters).toHaveBeenLastCalledWith([
      0.25, 1, 1, -60,
    ]);
    fake.created.options!.onPublished!(Float64Array.of(-12));
    expect(byId['meter']!.get()).toBe(-12);
    fake.created.options!.onStreams!([[0, 0.5]]);
    expect(published).toEqual([[0, 0.5]]);
    audio.dispose();
    byId['gain']!.set(0.75);
    expect(fake.processor.setParameters).toHaveBeenCalledTimes(2);
  });

  it('sends the processing the state it reads, once per batch of changes', async () => {
    const store = new StateStore(
      describeState({
        tab: { type: 'int32', default: 0 },
        mode: { type: 'int32', default: 2, audio: true },
        pattern: {
          type: 'uint8[]',
          default: [1, 2],
          audio: true,
          maxLength: 4,
        },
      }),
    );
    const state = processorState(store);
    // mode at 0; pattern's length at 4, its elements at 8.
    expect(state.size).toBe(12);
    const read = (bytes: Uint8Array) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      const length = view.getUint32(4, true);
      return {
        mode: view.getInt32(0, true),
        pattern: [...bytes.subarray(8, 8 + length)],
      };
    };
    const fake = fakeProcessor();
    const { audio } = setup(
      async () => ({
        wasm: new Uint8Array(),
        parameters: [],
        streams: [],
        publishStream: () => {},
        state,
      }),
      { createProcessorNode: fake.create },
    );
    await audio.start();
    expect(fake.created.options?.contract.state).toBe(12);
    expect(read(fake.created.options!.state!)).toEqual({
      mode: 2,
      pattern: [1, 2],
    });
    const sent = () => fake.processor.setState.mock.calls.map(([b]) => read(b));
    const settled = () => new Promise<void>((done) => queueMicrotask(done));
    fake.processor.setState.mockClear();

    // A transaction's fields arrive in one snapshot.
    store.history.transaction('Both', () => {
      store.fields['mode']!.set(5);
      store.fields['pattern']!.set([9, 9, 9]);
    });
    await settled();
    expect(sent()).toEqual([{ mode: 5, pattern: [9, 9, 9] }]);
    // Rapid writes coalesce into the latest.
    for (let value = 0; value < 10; value++) store.fields['mode']!.set(value);
    await settled();
    expect(sent().at(-1)).toEqual({ mode: 9, pattern: [9, 9, 9] });
    expect(sent()).toHaveLength(2);
    // History and restoration reach it too; UI-only fields do not. (The
    // writes above were not recorded: undo reverts the transaction.)
    store.history.undo();
    await settled();
    expect(sent().at(-1)).toEqual({ mode: 2, pattern: [1, 2] });
    store.history.redo();
    await settled();
    expect(sent().at(-1)).toEqual({ mode: 5, pattern: [9, 9, 9] });
    store.restore(store.prepare({ pattern: [] }));
    await settled();
    expect(sent().at(-1)).toEqual({ mode: 2, pattern: [] });
    const count = sent().length;
    store.fields['tab']!.set(3);
    await settled();
    expect(sent()).toHaveLength(count);
    // Beyond maxLength, a write is refused, and nothing is sent.
    expect(() => store.fields['pattern']!.set([1, 2, 3, 4, 5])).toThrow(
      /maxLength of 4/,
    );
    audio.dispose();
    store.fields['mode']!.set(1);
    await settled();
    expect(sent()).toHaveLength(count);
  });

  it('passes the input through when the processor cannot start', async () => {
    const fake = fakeProcessor(
      Promise.reject(new Error('built from another soundor.config')),
    );
    fake.processor.ready.catch(() => {});
    const { audio, host, context } = setup(
      async () => ({
        wasm: new Uint8Array(),
        parameters: [],
        streams: [],
        publishStream: () => {},
      }),
      { createProcessorNode: fake.create },
    );
    await audio.start();
    host.play();
    expect(audio.status.error).toMatch(
      /could not start, so the input passes through: built from another/,
    );
    expect(fake.processor.dispose).toHaveBeenCalled();
    expect(reaches(context.sources[0]!, context.destination)).toBe(true);
  });

  it('passes through, and says why, when the processor cannot load', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { audio, host, context } = setup(async () => {
      throw new Error('no worklet');
    });
    await audio.start();
    host.play();
    expect(audio.status.state).toBe('running');
    expect(audio.status.error).toMatch(/could not start.*no worklet/);
    expect(reaches(context.sources[0]!, context.destination)).toBe(true);
    reported.mockRestore();
  });

  it('reports a context that cannot start', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = new WebHost({
      frames: { request: () => 1, cancel: () => {} },
    });
    const audio = new WebAudioHost(host, {
      createContext: () => {
        throw new DOMException('not allowed', 'NotAllowedError');
      },
    });
    await audio.start();
    expect(audio.status).toMatchObject({
      state: 'failed',
      error: 'Audio could not start: not allowed',
    });
    reported.mockRestore();
  });

  it('plays the source while the transport plays, from the transport clock', async () => {
    const { audio, host, context } = setup();
    await audio.start();
    context.currentTime = 10;
    host.play();
    expect(context.sources).toHaveLength(1);
    context.currentTime = 12; // the transport runs on the audio clock
    host.pause();
    expect(context.sources[0]!.stopped).toBe(true);
    expect(host.snapshot().transport!.timeInSeconds).toBe(2);
    host.play();
    expect(context.sources).toHaveLength(2);
    host.stop();
    expect(context.sources[1]!.stopped).toBe(true);
  });

  it('switches sources, looping a file from the transport position', async () => {
    const { audio, host, context } = setup();
    await audio.start();
    host.play();
    context.currentTime = 5; // 5 s into the transport
    await audio.setSource('file', new Blob([new Uint8Array(4)]));
    const player = context.sources.at(-1)!;
    expect(player.kind).toBe('buffer');
    expect(player.loop).toBe(true);
    expect(player.started).toEqual([0, 1]); // 5 s into a 4 s file
    expect(context.sources[0]!.stopped).toBe(true);

    await audio.setSource('none');
    expect(player.stopped).toBe(true);
    expect(context.sources).toHaveLength(2);
    await expect(
      new WebAudioHost(host).setSource('file', new Blob([])),
    ).rejects.toThrow('Start audio before choosing a file');
  });

  it('sets the master volume and mutes', async () => {
    const { audio, context } = setup();
    await audio.start();
    const master = [...[...context.destination.connections]];
    expect(master).toEqual([]);
    audio.setVolume(0.5);
    audio.setMuted(true);
    expect(audio.status).toMatchObject({ volume: 0.5, muted: true });
    audio.setVolume(3);
    expect(audio.status.volume).toBe(1);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function microphone() {
  class Track extends EventTarget {
    readyState = 'live';
    stop = vi.fn<() => void>(() => {
      this.readyState = 'ended';
    });
  }
  const track = new Track();
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { track, stream };
}

describe('custom audio inputs', () => {
  it('registers labeled inputs, selects a default, and validates ids before starting audio', () => {
    const start = vi.fn<() => () => void>(() => () => {});
    const { audio, createContext } = setup(undefined, {
      inputs: [{ id: 'loop', label: 'My loop', start }],
      defaultInput: 'loop',
    });
    expect(audio.inputs).toContainEqual({ id: 'loop', label: 'My loop' });
    expect(audio.status.source).toBe('loop');
    expect(start).not.toHaveBeenCalled();
    expect(createContext).not.toHaveBeenCalled();
    for (const id of ['', 'oscillator', 'microphone', 'file', 'none']) {
      expect(() =>
        setup(undefined, { inputs: [{ id, label: 'Invalid', start }] }),
      ).toThrow(/id/);
    }
    expect(() =>
      setup(undefined, {
        inputs: [
          { id: 'x', label: 'X', start },
          { id: 'x', label: 'Again', start },
        ],
      }),
    ).toThrow(/id/);
    expect(() => setup(undefined, { defaultInput: 'unknown' })).toThrow(
      /Unknown default/,
    );
    expect(() => setup(undefined, { defaultInput: 'microphone' })).toThrow(
      /explicitly/,
    );
  });

  it('routes custom inputs through DSP and recreates them at the transport position on replay', async () => {
    const cleanup = vi.fn<() => void>(() => {});
    const starts: WebAudioInputContext[] = [];
    let source: FakeSource | undefined, effect: FakeGain | undefined;
    const fake = fakeProcessor();
    effect = fake.node as unknown as FakeGain;
    const { audio, host, context } = setup(
      async () => ({
        wasm: new Uint8Array(),
        parameters: [],
        streams: [],
        publishStream: () => {},
      }),
      {
        createProcessorNode: fake.create,
        inputs: [
          {
            id: 'loop',
            label: 'Loop',
            start(input) {
              starts.push(input);
              source = new FakeSource('custom');
              source.connect(input.destination as unknown as FakeNode);
              return () => {
                source!.disconnect();
                cleanup();
              };
            },
          },
        ],
        defaultInput: 'loop',
      },
    );
    await audio.start();
    expect(starts).toHaveLength(0);
    host.play();
    expect(reaches(source!, effect!)).toBe(true);
    expect(reaches(effect!, context.destination)).toBe(true);
    expect(starts[0]!.timeInSeconds).toBe(0);
    context.currentTime = 2;
    host.pause();
    expect(starts[0]!.signal.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    host.play();
    expect(starts[1]!.timeInSeconds).toBe(2);
    await audio.setSource('oscillator');
    expect(starts[1]!.signal.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(2);
    audio.dispose();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('disconnects an obsolete async input immediately and cleans up its late result', async () => {
    const pending = deferred<() => void>();
    const cleanup = vi.fn<() => void>(() => {});
    let instance: WebAudioInputContext | undefined;
    const { audio, host } = setup(undefined, {
      inputs: [
        {
          id: 'slow',
          label: 'Slow',
          start(input) {
            instance = input;
            return pending.promise;
          },
        },
      ],
      defaultInput: 'slow',
    });
    await audio.start();
    host.play();
    expect(audio.status.inputState).toBe('starting');
    await audio.setSource('oscillator');
    expect(instance!.signal.aborted).toBe(true);
    expect(
      (instance!.destination as unknown as FakeNode).connections.size,
    ).toBe(0);
    pending.resolve(cleanup);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    expect(audio.status).toMatchObject({
      source: 'oscillator',
      inputState: 'running',
      inputError: null,
    });
    audio.dispose();
  });

  it('ignores stale failures, surfaces current failures, and can retry', async () => {
    const pending = deferred<() => void>();
    const start = vi.fn<() => Promise<() => void>>(() => pending.promise);
    const { audio, host } = setup(undefined, {
      inputs: [{ id: 'slow', label: 'Slow', start }],
    });
    await audio.start();
    host.play();
    await audio.setSource('slow');
    await audio.setSource('oscillator');
    pending.reject(new Error('obsolete'));
    await Promise.resolve();
    expect(audio.status.inputError).toBeNull();
    await audio.setSource('slow');
    await vi.waitFor(() =>
      expect(audio.status.inputError).toContain('obsolete'),
    );
    start.mockImplementation(() => Promise.resolve(() => {}));
    await audio.setSource('slow');
    await vi.waitFor(() => expect(audio.status.inputState).toBe('running'));
    expect(audio.status.inputError).toBeNull();
    audio.dispose();
  });
});

describe('microphone input', () => {
  it('requests permission only when selected and playing, and releases capture on pause and switch', async () => {
    const first = microphone(),
      second = microphone();
    const getUserMedia = vi
      .fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream);
    const { audio, host, context } = setup(undefined, { getUserMedia });
    await audio.start();
    expect(getUserMedia).not.toHaveBeenCalled();
    await audio.setSource('microphone');
    expect(getUserMedia).not.toHaveBeenCalled();
    host.play();
    await vi.waitFor(() => expect(audio.status.inputState).toBe('running'));
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    expect(reaches(context.mediaSources[0]!, context.destination)).toBe(true);
    host.pause();
    expect(first.track.stop).toHaveBeenCalledOnce();
    host.play();
    await vi.waitFor(() => expect(context.mediaSources).toHaveLength(2));
    await audio.setSource('none');
    expect(second.track.stop).toHaveBeenCalledOnce();
    expect(context.mediaSources[1]!.connections.size).toBe(0);
    audio.dispose();
  });

  it.each(['switch', 'pause', 'dispose'] as const)(
    'stops a late permission result after %s, without connecting it',
    async (action) => {
      const pending = deferred<MediaStream>(),
        mic = microphone();
      const { audio, host, context } = setup(undefined, {
        getUserMedia: () => pending.promise,
      });
      await audio.start();
      host.play();
      await audio.setSource('microphone');
      if (action === 'switch') await audio.setSource('oscillator');
      else if (action === 'pause') host.pause();
      else audio.dispose();
      pending.resolve(mic.stream);
      await vi.waitFor(() => expect(mic.track.stop).toHaveBeenCalledOnce());
      expect(context.mediaSources).toHaveLength(0);
      expect(audio.status.inputState).not.toBe('failed');
      audio.dispose();
    },
  );

  it('reports denied permission and allows another input to work', async () => {
    const getUserMedia = vi
      .fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const { audio, host } = setup(undefined, { getUserMedia });
    await audio.start();
    host.play();
    await audio.setSource('microphone');
    await vi.waitFor(() => expect(audio.status.inputState).toBe('failed'));
    expect(audio.status.inputError).toMatch(/permission was denied/);
    expect(audio.status.state).toBe('running');
    await audio.setSource('oscillator');
    expect(audio.status).toMatchObject({
      source: 'oscillator',
      inputState: 'running',
      inputError: null,
    });
    audio.dispose();
  });

  it('releases all tracks and exposes device disconnection', async () => {
    const mic = microphone();
    const { audio, host } = setup(undefined, {
      getUserMedia: async () => mic.stream,
    });
    await audio.start();
    host.play();
    await audio.setSource('microphone');
    await vi.waitFor(() => expect(audio.status.inputState).toBe('running'));
    mic.track.dispatchEvent(new Event('ended'));
    expect(mic.track.stop).toHaveBeenCalledOnce();
    expect(audio.status).toMatchObject({ inputState: 'failed' });
    expect(audio.status.inputError).toMatch(/disconnected/);
    audio.dispose();
  });
});

it('does not restore an old file selection after its decode completes late', async () => {
  const pending = deferred<{ duration: number }>();
  const { audio, host, context } = setup();
  vi.spyOn(context, 'decodeAudioData').mockReturnValue(pending.promise);
  await audio.start();
  host.play();
  const loading = audio.setSource('file', new Blob(['data']));
  await vi.waitFor(() =>
    expect(context.decodeAudioData).toHaveBeenCalledOnce(),
  );
  await audio.setSource('none');
  pending.resolve({ duration: 4 });
  await loading;
  expect(audio.status).toMatchObject({
    source: 'none',
    fileName: null,
    inputState: 'idle',
  });
  audio.dispose();
});

it('cleans up a processor that finishes starting after disposal, without creating a source', async () => {
  const pending = deferred<void>();
  const fake = fakeProcessor(pending.promise);
  const { audio, host, context } = setup(
    async () => ({
      wasm: new Uint8Array(),
      parameters: [],
      streams: [],
      publishStream: () => {},
    }),
    { createProcessorNode: fake.create },
  );
  host.play();
  const starting = audio.start();
  await vi.waitFor(() => expect(fake.create).toHaveBeenCalledOnce());
  audio.dispose();
  pending.resolve();
  await starting;
  expect(fake.processor.dispose).toHaveBeenCalledOnce();
  expect(context.sources).toHaveLength(0);
  expect(context.closed).toBe(true);
});

it('releases a granted microphone if the Web Audio connection cannot be created', async () => {
  const mic = microphone();
  const { audio, host, context } = setup(undefined, {
    getUserMedia: async () => mic.stream,
  });
  vi.spyOn(context, 'createMediaStreamSource').mockImplementation(() => {
    throw new Error('Device connection failed');
  });
  await audio.start();
  host.play();
  await audio.setSource('microphone');
  await vi.waitFor(() => expect(audio.status.inputState).toBe('failed'));
  expect(mic.track.stop).toHaveBeenCalledOnce();
  expect(audio.status.inputError).toContain('Device connection failed');
  audio.dispose();
});

it('replaces default inputs, always retaining No input', async () => {
  const { audio, host, context } = setup(undefined, { configuredInputs: [] });
  expect(audio.inputs).toEqual([{ id: 'none', label: 'No input' }]);
  expect(audio.status.source).toBe('none');
  await expect(audio.setSource('oscillator')).rejects.toThrow(
    'Unknown audio input',
  );
  await audio.start();
  host.play();
  expect(context.sources).toHaveLength(0);
  audio.dispose();
});

it('runs configured built-ins with their options through the existing audio graph', async () => {
  const { audio, host, context } = setup(undefined, {
    configuredInputs: [
      { type: 'oscillator', waveform: 'sine', frequency: 440, gain: 0.1 },
    ],
  });
  expect(audio.inputs.map(({ id }) => id)).toEqual(['oscillator', 'none']);
  await audio.start();
  host.play();
  const source = context.sources[0]!;
  expect(source.type).toBe('sine');
  expect(source.frequency.value).toBe(440);
  const level = [...source.connections][0] as FakeGain;
  expect(level.gain.value).toBe(0.1);
  expect(reaches(source, context.destination)).toBe(true);
  host.pause();
  expect(source.stopped).toBe(true);
  audio.dispose();
});

it('composes custom and built-in inputs without adding omitted defaults', async () => {
  const cleanup = vi.fn<() => void>();
  const start = vi.fn<() => () => void>(() => cleanup);
  const { audio, host } = setup(undefined, {
    configuredInputs: [{ id: 'demo', label: 'Demo', start }, { type: 'file' }],
  });
  expect(audio.status.source).toBe('demo');
  expect(audio.inputs.map(({ id }) => id)).toEqual(['demo', 'file', 'none']);
  await audio.start();
  host.play();
  expect(start).toHaveBeenCalledOnce();
  host.pause();
  expect(cleanup).toHaveBeenCalledOnce();
  audio.dispose();
});
