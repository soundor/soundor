import { describe, expect, it, vi } from 'vitest';

import {
  WebAudioHost,
  type WebAudioSetup,
  type WebAudioHostOptions,
  type WebAudioInputContext,
} from './audio';
import { WebHost } from './host';

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

function setup(
  loadSetup?: () => Promise<WebAudioSetup | undefined>,
  options: Omit<WebAudioHostOptions, 'loadSetup' | 'createContext'> = {},
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
    loadSetup,
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

  it("puts the project's nodes between input and output, and cleans up", async () => {
    const cleanup = vi.fn<() => void>();
    let effect: FakeGain | undefined;
    const projectSetup: WebAudioSetup = ({ context, input, output }) => {
      effect = (context as unknown as FakeContext).createGain();
      (input as unknown as FakeNode).connect(effect);
      effect.connect(output as unknown as FakeNode);
      return cleanup;
    };
    const { audio, host, context } = setup(async () => projectSetup);
    await audio.start();
    host.play();
    const oscillator = context.sources[0]!;
    expect(reaches(oscillator, effect!)).toBe(true);
    expect(reaches(effect!, context.destination)).toBe(true);

    audio.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(oscillator.stopped).toBe(true);
    expect(context.closed).toBe(true);
  });

  it('follows a parameter in the project setup: one store, no copy', async () => {
    const { createParameterStore } = await import('./parameters');
    const { byId } = createParameterStore([
      {
        id: 'gain',
        label: 'Gain',
        type: 'float',
        min: 0,
        max: 1,
        default: 0.5,
      },
    ]);
    let node: FakeGain | undefined;
    const projectSetup: WebAudioSetup = ({ context, input, output }) => {
      node = (context as unknown as FakeContext).createGain();
      node.gain.value = byId['gain']!.get() as number;
      const unsubscribe = byId['gain']!.subscribe((value) => {
        node!.gain.setTargetAtTime(value as number);
      });
      (input as unknown as FakeNode).connect(node);
      node.connect(output as unknown as FakeNode);
      return unsubscribe;
    };
    const { audio } = setup(async () => projectSetup);
    await audio.start();
    expect(node!.gain.value).toBe(0.5);
    byId['gain']!.set(0.25);
    expect(node!.gain.value).toBe(0.25);
    audio.dispose();
    byId['gain']!.set(0.75);
    expect(node!.gain.value).toBe(0.25);
  });

  it('passes through, and says why, when the project setup fails', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { audio, host, context } = setup(async () => () => {
      throw new Error('no worklet');
    });
    await audio.start();
    host.play();
    expect(audio.status.state).toBe('running');
    expect(audio.status.error).toMatch(/audio\.ts\) failed.*no worklet/);
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
    const { audio, host, context } = setup(
      async () =>
        ({ input, output }) => {
          effect = new FakeGain();
          (input as unknown as FakeNode).connect(effect);
          effect.connect(output as unknown as FakeNode);
        },
      {
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

it('cleans up DSP that finishes setting up after disposal, without creating a source', async () => {
  const pending = deferred<() => void>(),
    cleanup = vi.fn<() => void>(() => {});
  const projectSetup = vi.fn<WebAudioSetup>(() => pending.promise);
  const { audio, host, context } = setup(async () => projectSetup);
  host.play();
  const starting = audio.start();
  await vi.waitFor(() => expect(projectSetup).toHaveBeenCalledOnce());
  audio.dispose();
  pending.resolve(cleanup);
  await starting;
  expect(cleanup).toHaveBeenCalledOnce();
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
