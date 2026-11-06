// The audio helpers with a real plugin: the host's own fixtures in the real
// host, with no display. Runs only when told where they are:
//
//   pnpm --filter @soundor/vst3-host build:native
//   (cd hosts/vst3-host && cmake --workflow --preset dev)
//   SOUNDOR_VST3_HOST_FIXTURES=<hosts/vst3-host/build/dev/fixtures> \
//     pnpm --filter @soundor/vitest-e2e exec vitest run src/audio.plugin.test.ts
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, test } from 'vitest';

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
import { launchHost } from './launch';

const fixtures = process.env['SOUNDOR_VST3_HOST_FIXTURES'];

describe.runIf(fixtures)('the audio helpers on real fixtures', () => {
  const start = (className: string, options = {}) =>
    launchHost({
      cwd: process.cwd(),
      plugin: `${fixtures}/SoundorHostFixtures.vst3`,
      className,
      ...options,
    });
  const snapshots = join(dirname(import.meta.filename), '__snapshots__');
  afterAll(() => rmSync(snapshots, { recursive: true, force: true }));

  test('a tone keeps its frequency and follows the gain', async () => {
    const host = await start('Fixture Gain');
    const gain = host.parameter('Gain');
    const tone = sine(1000, { seconds: 0.25, amplitude: 0.5 });

    await gain.set(1);
    const loud = await host.process({ inputs: [[tone, tone]] });
    await gain.set(0.25);
    const quiet = await host.process({ inputs: [[tone, tone]] });

    expect(dominantFrequency(loud.outputs[0]![0]!)).toBeCloseTo(1000, 0);
    expect(rms(quiet.outputs[0]!)).toBeLessThan(rms(loud.outputs[0]!));
    expect(peak(quiet.outputs[0]!)).toBeGreaterThan(0);
  });

  test('silence stays silent, and sound does not', async () => {
    const host = await start('Fixture Gain');
    const nothing = silence({ frames: 4800 });
    const off = await host.process({ inputs: [[nothing, nothing]] });
    expect(off.outputs[0]).toBeSilent();

    const blip = impulse({ frames: 4800, at: 100 });
    const on = await host.process({ inputs: [[blip, blip]] });
    expect(on.outputs[0]).not.toBeSilent();
  });

  test('irregular blocks give the same audio as one call', async () => {
    const signal = noise({ frames: 9600, amplitude: 0.5 });
    const inputs = [[signal, signal]];
    const whole = await (await start('Fixture Gain')).process({ inputs });
    const cut = await render(await start('Fixture Gain'), {
      inputs,
      blockSize: [37, 512, 64, 1, 200],
    });
    expect(cut.frames).toBe(9600);
    expect(cut.outputs[0]).toBeCloseToAudio(whole.outputs[0]!);
  });

  test('a snapshot is saved, matches, and sees a change', async () => {
    const host = await start('Fixture Gain');
    const tone = sine(440, { frames: 2048, amplitude: 0.5 });
    const first = await host.process({ inputs: [[tone, tone]] });
    expect(first.outputs[0]).toMatchAudioSnapshot('tone');
    const again = await host.process({ inputs: [[tone, tone]] });
    expect(again.outputs[0]).toMatchAudioSnapshot('tone');

    await host.parameter('Gain').set(1);
    const louder = await host.process({ inputs: [[tone, tone]] });
    expect(() =>
      expect(louder.outputs[0]).toMatchAudioSnapshot('tone'),
    ).toThrow('samples differ');
  });

  test('notes sound where they were sent, through blocks too', async () => {
    const host = await start('Fixture Synth', { blockSize: 64 });
    const { outputs, events } = await render(host, {
      frames: 400,
      blockSize: [64, 13],
      events: [
        noteOn(60, { time: 10, velocity: 0.5 }),
        noteOff(60, { time: 300 }),
      ],
    });
    const level = outputs[0]![0]!;
    expect(level[9]).toBe(0);
    expect(level[10]).toBe(0.5);
    expect(level[299]).toBe(0.5);
    expect(level[300]).toBe(0);
    expect(events.map(({ type, time }) => [type, time])).toEqual([
      ['noteOn', 10],
      ['noteOff', 300],
    ]);
  });
});
