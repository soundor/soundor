import {
  impulse,
  launchHost,
  noise,
  peak,
  render,
  rms,
  silence,
} from '@soundor/vitest-e2e';
import { expect, test } from 'vitest';

const sampleRate = 48_000;

type Host = Awaited<ReturnType<typeof launchHost>>;

/** Maps a time in beats to its parameter's 0 to 1 (see soundor.config.ts). */
const beats = (value: number) => (value - 0.125) / 2.875;

/**
 * The first voice alone and fully wet, with no drift or repeats, the filter
 * wide open, and free time (500 ms per beat), so that what a test then changes
 * is all that can make a difference.
 */
const oneVoice = {
  'Tempo sync': 0,
  Mix: 1,
  Motion: 0,
  Tone: 1,
  Feedback: 0,
  'Echo 1 level': 1,
  'Echo 2 level': 0,
  'Echo 3 level': 0,
};

/** Sets parameters by title, and lets the plugin's smoothing arrive at them. */
async function settle(host: Host, settings: Record<string, number>) {
  for (const [title, value] of Object.entries(settings))
    await host.parameter(title).set(value);
  await host.process({ frames: sampleRate });
}

const peakFrame = (channel: Float32Array) =>
  channel.reduce(
    (best, sample, frame) =>
      Math.abs(sample) > Math.abs(channel[best]!) ? frame : best,
    0,
  );

test('an echo comes back after the time it is set to', async () => {
  const host = await launchHost();
  await settle(host, { ...oneVoice, 'Echo 1 time': beats(1) });

  const click = impulse({ seconds: 1, amplitude: 0.5 });
  const { outputs } = await host.process({ inputs: [[click, click]] });

  // One beat of free time.
  expect(
    Math.abs(peakFrame(outputs[0]![0]!) - sampleRate / 2),
  ).toBeLessThanOrEqual(2);
});

test('with tempo sync, an echo follows the tempo of the host', async () => {
  const host = await launchHost();
  await settle(host, { ...oneVoice, 'Tempo sync': 1, 'Echo 1 time': beats(1) });

  const transport = { playing: true, tempo: 60 };
  await host.process({ frames: sampleRate, transport });
  const click = impulse({ seconds: 1.5, amplitude: 0.5 });
  const { outputs } = await host.process({
    inputs: [[click, click]],
    transport,
  });

  // One beat at 60 BPM, twice what it is in free time.
  expect(Math.abs(peakFrame(outputs[0]![0]!) - sampleRate)).toBeLessThanOrEqual(
    2,
  );
});

test('at full Spread, the voices go to opposite sides', async () => {
  const sides = async (settings: Record<string, number>) => {
    const host = await launchHost();
    await settle(host, { ...oneVoice, Spread: 1, ...settings });
    const click = impulse({ seconds: 1.5, amplitude: 0.5 });
    const { outputs } = await host.process({ inputs: [[click, click]] });
    return { left: peak(outputs[0]![0]!), right: peak(outputs[0]![1]!) };
  };

  const first = await sides({});
  expect(first.left).toBeGreaterThan(0.1);
  expect(first.right).toBeLessThan(first.left / 100);

  const third = await sides({ 'Echo 1 level': 0, 'Echo 3 level': 1 });
  expect(third.right).toBeGreaterThan(0.1);
  expect(third.left).toBeLessThan(third.right / 100);
});

test('Feedback decides how long the echoes last', async () => {
  const tail = async (feedback: number) => {
    const host = await launchHost();
    await settle(host, { ...oneVoice, Feedback: feedback });
    const click = impulse({ seconds: 2.5, amplitude: 0.5 });
    const { outputs } = await host.process({ inputs: [[click, click]] });
    // After the first echo, at 0.375 seconds.
    return outputs[0]![0]!.subarray(sampleRate / 2);
  };

  expect(await tail(0)).toBeSilent();
  expect(peak(await tail(1))).toBeGreaterThan(0.01);
});

test('at the most Feedback, loud input stays bounded', async () => {
  const host = await launchHost();
  await settle(host, {
    Mix: 1,
    Feedback: 1,
    'Echo 1 level': 1,
    'Echo 2 level': 1,
    'Echo 3 level': 1,
  });

  const input = noise({ seconds: 10, seed: 2 });
  const { outputs } = await host.process({ inputs: [[input, input]] });

  expect(outputs[0]![0]!.every(Number.isFinite)).toBe(true);
  expect(peak(outputs[0]!)).toBeLessThan(2);
  // And it is not quiet either: the last second is still the echoes.
  expect(rms(outputs[0]![0]!.subarray(9 * sampleRate))).toBeGreaterThan(0.1);
});

test('Hold keeps looping what it caught, and ignores new input', async () => {
  const caught = async (next: Float32Array) => {
    const host = await launchHost();
    await settle(host, oneVoice);
    const phrase = noise({ seconds: 1, amplitude: 0.5, seed: 3 });
    await host.process({ inputs: [[phrase, phrase]] });
    await host.parameter('Hold').set(1);
    const { outputs } = await host.process({ inputs: [[next, next]] });
    return outputs[0]![0]!;
  };
  // Longer than the 10 second delay line: input that got in would reach the loop.
  const seconds = 11;

  const quiet = await caught(silence({ seconds }));
  // Without Feedback, only the loop can still be sounding this late.
  expect(rms(quiet.subarray((seconds - 1) * sampleRate))).toBeGreaterThan(0.01);

  const loud = await caught(noise({ seconds, seed: 4 }));
  expect(loud).toBeCloseToAudio(quiet, { tolerance: 0.001 });
});

test('the output does not depend on the size of the blocks', async () => {
  const played = async (blockSize: number | number[]) => {
    const host = await launchHost();
    await settle(host, { Motion: 0, 'Tempo sync': 0 });
    const input = noise({ seconds: 1, amplitude: 0.5, seed: 5 });
    const { outputs } = await render(host, {
      inputs: [[input, input]],
      blockSize,
    });
    return outputs[0]!;
  };

  expect(await played([37, 512, 64])).toBeCloseToAudio(await played(512));
});

test('a saved session restores what the processor plays', async () => {
  const first = await launchHost();
  await first.parameter('Mix').set(0.25);
  await first.parameter('Hold').set(1);
  const state = await first.getState();

  const second = await launchHost();
  await second.setState(state);

  expect((await second.parameter('Mix').get()).normalized).toBeCloseTo(0.25);
  expect((await second.parameter('Hold').get()).normalized).toBe(1);
});
