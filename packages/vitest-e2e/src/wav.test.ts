import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { sine } from './audio';
import { decodeWav, encodeWav, readWav, writeWav } from './wav';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A WAV file of raw samples, as other tools write them. */
function wav(
  format: number,
  bits: number,
  count: number,
  samples: number[],
  { extra = new Uint8Array(), extensible = false } = {},
): Uint8Array {
  const width = bits / 8;
  const data = new Uint8Array(samples.length * width);
  const view = new DataView(data.buffer);
  samples.forEach((sample, i) => {
    const at = i * width;
    if (format === 3) view.setFloat32(at, sample, true);
    else if (bits === 8) view.setUint8(at, sample);
    else if (bits === 16) view.setInt16(at, sample, true);
    else if (bits === 24) {
      view.setUint16(at, sample & 0xffff, true);
      view.setInt8(at + 2, sample >> 16);
    } else view.setInt32(at, sample, true);
  });
  const fmt = extensible ? 40 : 16;
  const pad = extra.length % 2;
  const body = 4 + 8 + fmt + 8 + extra.length + pad + 8 + data.length;
  const bytes = new Uint8Array(8 + body);
  const out = new DataView(bytes.buffer);
  const tag = (at: number, text: string) =>
    [...text].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  tag(0, 'RIFF');
  out.setUint32(4, body, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  out.setUint32(16, fmt, true);
  out.setUint16(20, extensible ? 0xfffe : format, true);
  out.setUint16(22, count, true);
  out.setUint32(24, 44_100, true);
  out.setUint16(34, bits, true);
  if (extensible) out.setUint16(44, format, true);
  let at = 20 + fmt;
  tag(at, 'LIST');
  out.setUint32(at + 4, extra.length, true);
  bytes.set(extra, at + 8);
  at += 8 + extra.length + pad;
  tag(at, 'data');
  out.setUint32(at + 4, data.length, true);
  bytes.set(data, at + 8);
  return bytes;
}

describe('decodeWav', () => {
  test.each([
    ['PCM 8', 1, 8, [128, 192, 0], [0, 0.5, -1]],
    ['PCM 16', 1, 16, [0, 0x4000, -0x8000], [0, 0.5, -1]],
    ['PCM 24', 1, 24, [0, 0x400000, -0x800000], [0, 0.5, -1]],
    ['PCM 32', 1, 32, [0, 0x40000000, -0x80000000], [0, 0.5, -1]],
    ['float', 3, 32, [0, 0.5, -1], [0, 0.5, -1]],
  ])('reads %s', (_, format, bits, samples, expected) => {
    const { channels, sampleRate } = decodeWav(wav(format, bits, 1, samples));
    expect(sampleRate).toBe(44_100);
    expect([...channels[0]!]).toEqual(expected);
  });

  test('splits interleaved channels', () => {
    const { channels } = decodeWav(wav(3, 32, 2, [0.25, 0.5, -0.25, -0.5]));
    expect([...channels[0]!]).toEqual([0.25, -0.25]);
    expect([...channels[1]!]).toEqual([0.5, -0.5]);
  });

  test('reads the extensible format', () => {
    const { channels } = decodeWav(wav(3, 32, 1, [0.5], { extensible: true }));
    expect([...channels[0]!]).toEqual([0.5]);
  });

  test('skips other chunks, on even bytes', () => {
    const extra = new Uint8Array(3).fill(9);
    const { channels } = decodeWav(wav(3, 32, 1, [0.5], { extra }));
    expect([...channels[0]!]).toEqual([0.5]);
  });

  test('says what is wrong', () => {
    expect(() => decodeWav(new Uint8Array(4), 'a.wav')).toThrow(
      'a.wav is not a WAV file',
    );
    expect(() => decodeWav(wav(6, 8, 1, [0]))).toThrow('cannot read');
    const noAudio = encodeWav({ sampleRate: 48_000, channels: [] });
    expect(() => decodeWav(noAudio)).toThrow('has no audio');
  });
});

describe('encodeWav', () => {
  test('keeps every sample exactly, through a file', () => {
    dir = mkdtempSync(join(tmpdir(), 'soundor-vitest-e2e-wav-'));
    const path = join(dir, 'new', 'folder', 'a.wav');
    const left = sine(440, { frames: 512 });
    const right = sine(880, { frames: 512 });
    writeWav(path, { sampleRate: 44_100, channels: [left, right] });
    expect(readFileSync(path).subarray(0, 4).toString()).toBe('RIFF');
    const read = readWav(path);
    expect(read.sampleRate).toBe(44_100);
    expect(read.channels).toEqual([left, right]);
  });

  test('refuses channels of different lengths', () => {
    expect(() =>
      encodeWav({
        sampleRate: 48_000,
        channels: [new Float32Array(1), new Float32Array(2)],
      }),
    ).toThrow('same length');
  });
});
