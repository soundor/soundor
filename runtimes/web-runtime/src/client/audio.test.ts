import { describe, expect, it, vi } from 'vitest';

import { WebAudioHost, type WebAudioSetup } from './audio';
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
  async decodeAudioData(): Promise<{ duration: number }> {
    return { duration: 4 };
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

function setup(loadSetup?: () => Promise<WebAudioSetup | undefined>) {
  let now = 0;
  const frames = { request: () => 1, cancel: () => {} };
  const host = new WebHost({ now: () => now, frames });
  const context = new FakeContext();
  const createContext = vi.fn<() => AudioContext>(
    () => context as unknown as AudioContext,
  );
  const audio = new WebAudioHost(host, { loadSetup, createContext });
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
