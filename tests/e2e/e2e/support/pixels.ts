// Reads the pixels of the PNGs the engine captures (8-bit RGBA or RGB, not
// interlaced), so a test can check a color where it should be drawn.
import { inflateSync } from 'node:zlib';

import type { Locator, Vst3Plugin } from '@soundor/vitest-e2e';

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** Device pixels per logical pixel. */
  readonly scale: number;
  /** RGBA at (x, y), in device pixels. */
  at(x: number, y: number): [number, number, number, number];
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

export function decodePng(png: Uint8Array, scale = 1): Pixels {
  const bytes = Buffer.from(png);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const depth = bytes[24];
  const color = bytes[25];
  if (depth !== 8 || (color !== 6 && color !== 2) || bytes[28] !== 0)
    throw new Error(`Unsupported PNG: depth ${depth}, color type ${color}`);
  const channels = color === 6 ? 4 : 3;
  const data: Buffer[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString('latin1', at + 4, at + 8) === 'IDAT')
      data.push(bytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const source = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? rows[row + x - channels]! : 0;
      const up = y > 0 ? rows[row - stride + x]! : 0;
      const upLeft =
        y > 0 && x >= channels ? rows[row - stride + x - channels]! : 0;
      const value = raw[source + x]!;
      const predicted =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? (left + up) >> 1
              : filter === 4
                ? paeth(left, up, upLeft)
                : 0;
      rows[row + x] = (value + predicted) & 0xff;
    }
  }
  return {
    width,
    height,
    scale,
    at(x, y) {
      const start = Math.floor(y) * stride + Math.floor(x) * channels;
      return [
        rows[start]!,
        rows[start + 1]!,
        rows[start + 2]!,
        channels === 4 ? rows[start + 3]! : 255,
      ];
    },
  };
}

/** A capture of the plugin's view, or of a locator's node. */
export async function capture(source: Vst3Plugin | Locator): Promise<Pixels> {
  const shot = await source.screenshot();
  return decodePng(shot.data, shot.scale);
}

/** `#rrggbb` as the RGBA a capture holds for it, opaque. */
export function rgba(hex: string): [number, number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff, 255];
}

/**
 * The share of the inner part of a capture (a margin of a quarter of each
 * side left out, where edges are antialiased) that is `hex`, within
 * `tolerance` per channel.
 */
export function coverage(pixels: Pixels, hex: string, tolerance = 2): number {
  const expected = rgba(hex);
  const [left, top] = [pixels.width / 4, pixels.height / 4];
  let matching = 0;
  let total = 0;
  for (let y = Math.floor(top); y < pixels.height - top; y += 1)
    for (let x = Math.floor(left); x < pixels.width - left; x += 1) {
      total += 1;
      if (
        pixels
          .at(x, y)
          .every(
            (channel, index) =>
              Math.abs(channel - expected[index]!) <= tolerance,
          )
      )
        matching += 1;
    }
  return total === 0 ? 0 : matching / total;
}

/** How many distinct colors a capture has: text drawn has several. */
export function distinctColors(pixels: Pixels): number {
  const seen = new Set<number>();
  for (let y = 0; y < pixels.height; y += 1)
    for (let x = 0; x < pixels.width; x += 1) {
      const [r, g, b] = pixels.at(x, y);
      seen.add((r << 16) | (g << 8) | b);
    }
  return seen.size;
}
