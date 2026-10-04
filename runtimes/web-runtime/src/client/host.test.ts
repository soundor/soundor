import { describe, expect, it, vi } from 'vitest';

import { HOST_NAME, WebHost, type HostSnapshot, type Transport } from './host';

/** A host on a manual clock, with animation frames run by hand. */
function testHost() {
  let time = 1000;
  let next = 1;
  const pending = new Map<number, () => void>();
  const host = new WebHost({
    now: () => time,
    frames: {
      request(callback) {
        pending.set(next, callback);
        return next++;
      },
      cancel(handle) {
        pending.delete(handle);
      },
    },
  });
  return {
    host,
    /** Advances the clock by `ms` and runs one animation frame. */
    frame(ms: number) {
      time += ms;
      const due = [...pending.values()];
      pending.clear();
      for (const callback of due) callback();
    },
    advance(ms: number) {
      time += ms;
    },
    framesPending: () => pending.size,
  };
}

const transport = (host: WebHost): Transport => host.snapshot().transport!;

describe('WebHost state', () => {
  it('starts stopped at the start, 120 BPM in 4/4, without Web Audio', () => {
    const { host } = testHost();
    expect(host.snapshot()).toEqual({
      sampleRate: 48000,
      blockSize: 128,
      hostName: HOST_NAME,
      transport: {
        playing: false,
        recording: false,
        looping: false,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        ppqPosition: 0,
        barStartPpq: 0,
        timeInSeconds: 0,
        timeInSamples: 0,
      },
    });
    expect(HOST_NAME).toBe('Soundor Web');
  });

  it('returns the same frozen snapshot until the state changes', () => {
    const { host } = testHost();
    const first = host.snapshot();
    expect(host.snapshot()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.transport)).toBe(true);
    expect(Object.isFrozen(first.transport!.timeSignature)).toBe(true);

    host.setBpm(90);
    const second = host.snapshot();
    expect(second).not.toBe(first);
    expect(host.snapshot()).toBe(second);
    expect(first.transport!.bpm).toBe(120);
  });

  it('reports the audio format the host sets', () => {
    const { host } = testHost();
    const seen = vi.fn<(snapshot: HostSnapshot) => void>();
    host.subscribe(seen);
    host.setAudioFormat({ sampleRate: 44100, blockSize: 128 });
    host.setAudioFormat({ sampleRate: 44100, blockSize: 128 });
    expect(seen).toHaveBeenCalledOnce();
    expect(host.snapshot()).toMatchObject({
      sampleRate: 44100,
      blockSize: 128,
    });
  });
});

describe('WebHost transport', () => {
  it('advances with the clock while playing, every frame', () => {
    const { host, frame, framesPending } = testHost();
    const seen: number[] = [];
    host.subscribe((snapshot) => seen.push(snapshot.transport!.ppqPosition));

    host.play();
    expect(transport(host).playing).toBe(true);
    expect(framesPending()).toBe(1);

    frame(500); // half a second at 120 BPM: one quarter note
    expect(transport(host)).toMatchObject({
      ppqPosition: 1,
      timeInSeconds: 0.5,
      timeInSamples: 24000,
    });
    frame(250);
    expect(transport(host).ppqPosition).toBe(1.5);
    expect(seen).toEqual([0, 1, 1.5]);
  });

  it('keeps one snapshot between frames', () => {
    const { host, frame, advance } = testHost();
    host.play();
    frame(100);
    const current = host.snapshot();
    advance(100);
    expect(host.snapshot()).toBe(current);
    frame(0);
    expect(host.snapshot().transport!.ppqPosition).toBeCloseTo(0.4);
  });

  it('pauses where it is and stops back at the start', () => {
    const { host, frame, framesPending } = testHost();
    host.play();
    frame(1000);
    host.pause();
    expect(transport(host)).toMatchObject({ playing: false, ppqPosition: 2 });
    expect(framesPending()).toBe(0);
    frame(5000);
    expect(transport(host).ppqPosition).toBe(2);

    host.play();
    frame(500);
    expect(transport(host).ppqPosition).toBe(3);
    host.stop();
    expect(transport(host)).toMatchObject({
      playing: false,
      ppqPosition: 0,
      barStartPpq: 0,
      timeInSeconds: 0,
    });
    expect(framesPending()).toBe(0);
  });

  it('ignores play while playing and pause while paused', () => {
    const { host, frame, framesPending } = testHost();
    host.pause();
    host.play();
    frame(500);
    host.play();
    expect(framesPending()).toBe(1);
    expect(transport(host).ppqPosition).toBe(1);
  });

  it('changes tempo without moving the musical position', () => {
    const { host, frame } = testHost();
    host.play();
    frame(1000); // 2 quarter notes at 120
    host.setBpm(60);
    expect(transport(host).ppqPosition).toBe(2);
    expect(transport(host).timeInSeconds).toBe(2);
    frame(1000); // 1 quarter note at 60
    expect(transport(host)).toMatchObject({ bpm: 60, ppqPosition: 3 });
  });

  it('clamps the tempo and rejects non-numbers', () => {
    const { host } = testHost();
    host.setBpm(5);
    expect(transport(host).bpm).toBe(20);
    host.setBpm(5000);
    expect(transport(host).bpm).toBe(999);
    expect(() => host.setBpm(Number.NaN)).toThrow(RangeError);
  });
});

describe('WebHost bars', () => {
  it.each([
    [4, 4, 5, 4],
    [3, 4, 3.5, 3],
    [3, 4, 6.2, 6],
    [6, 8, 4, 3],
    [6, 8, 5.9, 3],
    [7, 8, 7.5, 7],
    [2, 2, 9, 8],
    [5, 16, 2, 1.25],
  ])('in %i/%i, the bar of quarter note %f starts at %f', (n, d, ppq, bar) => {
    const { host, frame } = testHost();
    host.setTimeSignature(n, d);
    host.play();
    frame((ppq * 60_000) / 120);
    expect(transport(host).ppqPosition).toBeCloseTo(ppq);
    expect(transport(host).barStartPpq).toBeCloseTo(bar);
    expect(transport(host).timeSignature).toEqual({
      numerator: n,
      denominator: d,
    });
  });

  it('keeps the current bar when the signature changes mid-bar', () => {
    const { host, frame } = testHost();
    host.play();
    frame(2500); // 4/4, quarter note 5: bar 2 starts at 4
    host.setTimeSignature(3, 4);
    expect(transport(host).barStartPpq).toBe(4);
    frame(1500); // quarter note 8: bars of 3 from 4 → 7
    expect(transport(host).barStartPpq).toBe(7);
  });

  it('validates the signature', () => {
    const { host } = testHost();
    expect(() => host.setTimeSignature(0, 4)).toThrow(RangeError);
    expect(() => host.setTimeSignature(4.5, 4)).toThrow(RangeError);
    expect(() => host.setTimeSignature(4, 3)).toThrow(RangeError);
    expect(() => host.setTimeSignature(33, 4)).toThrow(RangeError);
  });
});

describe('WebHost looping', () => {
  it('loops the first four bars while looping', () => {
    const { host, frame } = testHost();
    host.setLooping(true);
    host.play();
    frame(7500); // quarter note 15
    expect(transport(host).ppqPosition).toBe(15);
    frame(1000); // 17 → wraps past 16 to 1
    expect(transport(host)).toMatchObject({
      looping: true,
      ppqPosition: 1,
      barStartPpq: 0,
      timeInSeconds: 0.5,
    });
  });

  it('loops bars of the time signature', () => {
    const { host, frame } = testHost();
    host.setTimeSignature(6, 8);
    host.setLooping(true);
    host.play();
    frame(6500); // quarter note 13; four bars of 3 end at 12
    expect(transport(host).ppqPosition).toBeCloseTo(1);
  });

  it('brings a position past the loop into it when looping starts', () => {
    const { host, frame } = testHost();
    host.play();
    frame(9000); // quarter note 18
    host.setLooping(true);
    expect(transport(host).ppqPosition).toBe(2);
    host.setLooping(false);
    frame(10_000);
    expect(transport(host).ppqPosition).toBe(22);
  });
});

describe('WebHost subscriptions and lifetime', () => {
  it('stops notifying a subscriber that unsubscribed', () => {
    const { host, frame } = testHost();
    const seen = vi.fn<(snapshot: HostSnapshot) => void>();
    const unsubscribe = host.subscribe(seen);
    host.play();
    frame(16);
    unsubscribe();
    frame(16);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('switches clocks without a jump', () => {
    const { host, frame } = testHost();
    host.play();
    frame(500);
    let audioTime = 90_000;
    host.setClock(() => audioTime);
    expect(transport(host).ppqPosition).toBe(1);
    audioTime += 500;
    frame(0);
    expect(transport(host).ppqPosition).toBe(2);
  });

  it('stops its frame loop when disposed', () => {
    const { host, frame, framesPending } = testHost();
    host.play();
    frame(16);
    host.dispose();
    expect(framesPending()).toBe(0);
  });
});
