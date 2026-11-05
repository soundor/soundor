// Live audio and the transport, headless: SDL's dummy output device plays in
// real time without a sound card.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { GAIN, PEAK, closeAll, constant, launch } from './fixtures.ts';

afterEach(closeAll);

const dummyAudio = { env: { SDL_AUDIO_DRIVER: 'dummy' } };

async function until(check: () => Promise<boolean>, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** A mono 16-bit WAV file of a constant level. */
function wav(frames: number, level: number): string {
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++)
    data.writeInt16LE(Math.round(level * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(48_000, 24);
  header.writeUInt32LE(96_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  const path = join(mkdtempSync(join(tmpdir(), 'vst3-host-wav-')), 'input.wav');
  writeFileSync(path, Buffer.concat([header, data]));
  return path;
}

test('sets and reads the transport without processing', async () => {
  const host = await launch('Fixture Gain');
  expect(await host.getTransport()).toMatchObject({
    playing: false,
    tempo: 120,
    samplePosition: 0,
  });
  expect(
    await host.setTransport({ tempo: 90, musicalPosition: 4 }),
  ).toMatchObject({ tempo: 90, samplePosition: 128_000, musicalPosition: 4 });
  // Processing starts from it.
  const { transport } = await host.process({ frames: 16 });
  expect(transport).toMatchObject({ tempo: 90, samplePosition: 128_000 });
  await expect(host.setTransport({ tempo: 0 })).rejects.toMatchObject({
    code: 'invalid-request',
  });
});

test('plays live: the plugin processes the input while the transport plays', async () => {
  const host = await launch('Fixture Gain', dummyAudio);
  expect(await host.getAudio()).toMatchObject({
    running: false,
    input: 'oscillator',
  });
  const status = await host.startAudio({ volume: 0.5 });
  expect(status).toMatchObject({ running: true, volume: 0.5, error: null });
  expect(status.device).toEqual(expect.any(String));

  // Stopped: the transport stays.
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect((await host.getTransport()).samplePosition).toBe(0);

  await host.setParameter(GAIN, 1);
  await host.setTransport({ playing: true });
  await until(async () => (await host.getTransport()).samplePosition > 4800);
  // The processor's output peak (an output parameter) reaches the controller.
  await until(async () => (await host.getParameter(PEAK)).normalized > 0.1);

  // Offline processing waits for live audio to stop.
  await expect(host.process({ frames: 16 })).rejects.toMatchObject({
    code: 'invalid-state',
  });
  // Requests that change the plugin still work while it plays.
  await host.reset();
  await host.getState();

  expect(await host.stopAudio()).toMatchObject({ running: false });
  const { outputs } = await host.process({
    inputs: [[constant(16, 0.5), constant(16, 0.5)]],
  });
  expect(outputs[0]![0]![15]).toBeCloseTo(0.5 * 2, 5);
});

test('plays a WAV file, and refuses what is not one', async () => {
  const host = await launch('Fixture Gain', dummyAudio);
  const file = wav(4800, 0.25);
  expect(await host.setAudio({ file })).toMatchObject({ input: 'file', file });
  await host.setParameter(GAIN, 1);
  await host.startAudio();
  await host.setTransport({ playing: true });
  await until(async () => (await host.getParameter(PEAK)).normalized > 0.1);

  await expect(
    host.setAudio({ file: join(tmpdir(), 'no-such-file.wav') }),
  ).rejects.toMatchObject({ code: 'invalid-request' });
  await expect(
    host.setAudio({ input: 'tape' as 'none' }),
  ).rejects.toMatchObject({ code: 'invalid-request' });
  expect(await host.setAudio({ input: 'none', muted: true })).toMatchObject({
    input: 'none',
    muted: true,
  });
});

test('fails to start without an audio device', async () => {
  const host = await launch('Fixture Gain', {
    env: { SDL_AUDIO_DRIVER: 'no-such-driver' },
  });
  await expect(host.startAudio()).rejects.toMatchObject({
    code: 'audio-unavailable',
  });
  expect(await host.getAudio()).toMatchObject({ running: false });
});
