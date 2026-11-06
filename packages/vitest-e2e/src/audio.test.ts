import type { ProcessRequest, Vst3Host } from '@soundor/vst3-host';
import { describe, expect, test, vi } from 'vitest';

import {
  dominantFrequency,
  impulse,
  noise,
  noteOff,
  noteOn,
  peak,
  render,
  rms,
  silence,
  sine,
} from './audio';

describe('signals', () => {
  test('have a length in seconds or frames', () => {
    expect(silence().length).toBe(48_000);
    expect(silence({ seconds: 0.5 }).length).toBe(24_000);
    expect(silence({ seconds: 1, sampleRate: 44_100 }).length).toBe(44_100);
    expect(silence({ frames: 10 }).length).toBe(10);
    expect(() => silence({ frames: 10, seconds: 1 })).toThrow('not both');
    expect(() => silence({ frames: 1.5 })).toThrow('whole number');
  });

  test('sine starts at zero and has its amplitude', () => {
    const signal = sine(1000, { frames: 480, amplitude: 0.5 });
    expect(signal[0]).toBe(0);
    expect(peak(signal)).toBeCloseTo(0.5, 2);
    expect(rms(signal)).toBeCloseTo(0.5 / Math.SQRT2, 3);
  });

  test('impulse is one sample', () => {
    const signal = impulse({ frames: 8, at: 3, amplitude: 0.5 });
    expect([...signal]).toEqual([0, 0, 0, 0.5, 0, 0, 0, 0]);
    expect(() => impulse({ frames: 8, at: 8 })).toThrow('outside');
  });

  test('noise repeats for a seed, stays in range, and is noise', () => {
    const signal = noise({ frames: 4800, amplitude: 0.5 });
    expect([...signal]).toEqual([...noise({ frames: 4800, amplitude: 0.5 })]);
    expect([...signal]).not.toEqual([
      ...noise({ frames: 4800, amplitude: 0.5, seed: 2 }),
    ]);
    expect(peak(signal)).toBeLessThanOrEqual(0.5);
    expect(rms(signal)).toBeCloseTo(0.5 / Math.sqrt(3), 1);
    expect(Math.abs(signal.reduce((sum, x) => sum + x, 0) / 4800)).toBeLessThan(
      0.05,
    );
  });
});

describe('measuring', () => {
  test('peak and rms take a channel or a bus', () => {
    const left = Float32Array.of(0.5, -1);
    const right = Float32Array.of(0, 0);
    expect(peak(left)).toBe(1);
    expect(peak([right, left])).toBe(1);
    expect(rms(Float32Array.of(1, -1))).toBe(1);
    expect(rms([Float32Array.of(1, 1), Float32Array.of(0, 0)])).toBeCloseTo(
      Math.SQRT1_2,
    );
    expect(peak(new Float32Array())).toBe(0);
    expect(rms(new Float32Array())).toBe(0);
  });

  test.each([55, 440, 1000, 1234.5, 12_000])(
    'dominantFrequency finds %d Hz',
    (hz) => {
      expect(dominantFrequency(sine(hz, { seconds: 0.5 }))).toBeCloseTo(hz, 0);
    },
  );

  test('dominantFrequency uses the sample rate, and the stronger of two', () => {
    const rate = 44_100;
    const strong = sine(2000, { sampleRate: rate });
    const mix = sine(300, { sampleRate: rate, amplitude: 0.2 }).map(
      (sample, i) => sample + strong[i]!,
    );
    expect(Math.abs(dominantFrequency(mix, rate) - 2000)).toBeLessThan(1);
  });

  test('dominantFrequency has none for silence or too little', () => {
    expect(dominantFrequency(silence({ frames: 1024 }))).toBe(0);
    expect(dominantFrequency(new Float32Array(2))).toBe(0);
  });

  test('dominantFrequency ignores a constant offset', () => {
    const signal = sine(440, { seconds: 0.5 }).map((sample) => sample + 0.9);
    expect(Math.abs(dominantFrequency(signal) - 440)).toBeLessThan(5);
  });
});

test('notes have their defaults, and take options', () => {
  expect(noteOn(60)).toEqual({ type: 'noteOn', pitch: 60, velocity: 0.8 });
  expect(noteOn(60, { velocity: 0.5, time: 10, channel: 2 })).toEqual({
    type: 'noteOn',
    pitch: 60,
    velocity: 0.5,
    time: 10,
    channel: 2,
  });
  expect(noteOff(60, { time: 20 })).toEqual({
    type: 'noteOff',
    pitch: 60,
    time: 20,
  });
});

describe('render', () => {
  /** A host that echoes its input, and reports what it was given. */
  function echoing() {
    const calls: ProcessRequest[] = [];
    const host = {
      process: vi.fn(async (request: ProcessRequest) => {
        calls.push(request);
        const frames = request.frames!;
        return {
          frames,
          outputs: [
            request.inputs?.[0]?.map((channel) => channel.slice()) ?? [
              new Float32Array(frames),
            ],
          ],
          events: (request.events ?? []).map((event) => ({
            ...event,
            time: event.time ?? 0,
          })),
          parameterChanges: (request.parameterChanges ?? []).map((change) => ({
            ...change,
            time: change.time ?? 0,
          })),
          transport: { samplePosition: frames },
          warnings: frames === 3 ? ['three'] : [],
        };
      }),
    } as unknown as Vst3Host;
    return { host, calls };
  }

  const ramp = (frames: number) =>
    Float32Array.from({ length: frames }, (_, i) => i);

  test('cuts the request into calls and joins the audio', async () => {
    const { host, calls } = echoing();
    const left = ramp(10);
    const right = ramp(10).map((x) => -x);
    const result = await render(host, {
      inputs: [[left, right]],
      blockSize: 4,
    });
    expect(calls.map(({ frames }) => frames)).toEqual([4, 4, 2]);
    expect(result.frames).toBe(10);
    expect(result.outputs[0]).toEqual([left, right]);
  });

  test('takes sizes in turn', async () => {
    const { host, calls } = echoing();
    await render(host, { frames: 12, blockSize: [1, 3] });
    expect(calls.map(({ frames }) => frames)).toEqual([1, 3, 1, 3, 1, 3]);
  });

  test('puts events and changes in their call, and back in their place', async () => {
    const { host, calls } = echoing();
    const result = await render(host, {
      frames: 10,
      blockSize: 4,
      events: [noteOn(60, { time: 5 }), noteOff(60)],
      parameterChanges: [{ id: 1, value: 0.5, time: 9 }],
    });
    expect(calls.map(({ events }) => events?.length)).toEqual([1, 1, 0]);
    expect(calls[1]!.events![0]!.time).toBe(1);
    expect(calls[2]!.parameterChanges![0]!.time).toBe(1);
    expect(result.events.map(({ time }) => time)).toEqual([0, 5]);
    expect(result.parameterChanges[0]!.time).toBe(9);
  });

  test('changes the transport once, and ends with the last', async () => {
    const { host, calls } = echoing();
    const result = await render(host, {
      frames: 6,
      blockSize: 2,
      transport: { playing: true },
    });
    expect(calls.map(({ transport }) => transport)).toEqual([
      { playing: true },
      undefined,
      undefined,
    ]);
    expect(result.transport.samplePosition).toBe(2);
  });

  test('gathers warnings', async () => {
    const { host } = echoing();
    const result = await render(host, { frames: 6, blockSize: 3 });
    expect(result.warnings).toEqual(['three', 'three']);
  });

  test('refuses what it cannot cut', async () => {
    const { host } = echoing();
    await expect(render(host, { blockSize: 4 })).rejects.toThrow(
      'needs `frames`',
    );
    await expect(render(host, { frames: 4, blockSize: 0 })).rejects.toThrow(
      'above zero',
    );
    await expect(render(host, { frames: 4, blockSize: [] })).rejects.toThrow(
      'above zero',
    );
  });

  test('delivers parameter changes of no frames', async () => {
    const { host, calls } = echoing();
    const parameterChanges = [{ id: 1, value: 0.5 }];
    await render(host, { frames: 0, blockSize: 4, parameterChanges });
    expect(calls[0]).toMatchObject({ frames: 0, parameterChanges });
  });
});
