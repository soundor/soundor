import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { AudioBus } from '@soundor/vst3-host';

/** Audio with what a file records about it. */
export interface WavAudio {
  sampleRate: number;
  /** One array per channel, from -1 to 1. */
  channels: Float32Array[];
}

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

/** Reads PCM of 8, 16, 24 or 32 bits, or 32-bit float. */
export function decodeWav(bytes: Uint8Array, name = 'The file'): WavAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) =>
    String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE')
    throw new Error(`${name} is not a WAV file`);

  let format: number | undefined;
  let count = 0;
  let sampleRate = 0;
  let bits = 0;
  let data: Uint8Array | undefined;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (tag(at) === 'fmt ' && body + 16 <= bytes.length) {
      format = view.getUint16(body, true);
      count = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === EXTENSIBLE && size >= 26)
        format = view.getUint16(body + 24, true);
    } else if (tag(at) === 'data') {
      data = bytes.subarray(body, Math.min(body + size, bytes.length));
    }
    // Chunks start on even bytes.
    at = body + size + (size % 2);
  }
  if (format === undefined || data === undefined || count === 0)
    throw new Error(`${name} has no audio`);
  const supported =
    (format === PCM && [8, 16, 24, 32].includes(bits)) ||
    (format === FLOAT && bits === 32);
  if (!supported)
    throw new Error(
      `${name} has a format this cannot read: ${format}, ${bits} bits`,
    );

  const width = bits / 8;
  const frames = Math.floor(data.length / (width * count));
  const samples = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const read = (at: number): number => {
    if (format === FLOAT) return samples.getFloat32(at, true);
    if (bits === 8) return (samples.getUint8(at) - 128) / 128;
    if (bits === 16) return samples.getInt16(at, true) / 0x8000;
    if (bits === 24)
      return (
        ((samples.getInt8(at + 2) << 16) | samples.getUint16(at, true)) /
        0x800000
      );
    return samples.getInt32(at, true) / 0x80000000;
  };
  const channels = Array.from({ length: count }, (_, channel) =>
    Float32Array.from({ length: frames }, (_, frame) =>
      read((frame * count + channel) * width),
    ),
  );
  return { sampleRate, channels };
}

/** 32-bit float, so that nothing is lost: what a plugin made is what is kept. */
export function encodeWav(audio: {
  sampleRate: number;
  channels: AudioBus;
}): Uint8Array {
  const { sampleRate, channels } = audio;
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  if (channels.some((channel) => channel.length !== frames))
    throw new RangeError('All the channels of a WAV file have the same length');
  const size = frames * count * 4;
  const bytes = new Uint8Array(44 + size);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string) => {
    for (let i = 0; i < 4; ++i) bytes[at + i] = text.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + size, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, FLOAT, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 4, true);
  view.setUint16(32, count * 4, true);
  view.setUint16(34, 32, true);
  tag(36, 'data');
  view.setUint32(40, size, true);
  for (let frame = 0; frame < frames; ++frame)
    for (let channel = 0; channel < count; ++channel)
      view.setFloat32(
        44 + (frame * count + channel) * 4,
        channels[channel]![frame]!,
        true,
      );
  return bytes;
}

/** Reads a WAV file: PCM of 8, 16, 24 or 32 bits, or 32-bit float. */
export function readWav(path: string): WavAudio {
  return decodeWav(readFileSync(path), path);
}

/** Writes a 32-bit float WAV file, making its folder if needed. */
export function writeWav(
  path: string,
  audio: { sampleRate: number; channels: AudioBus },
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodeWav(audio));
}
