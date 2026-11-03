import { describe, expect, test } from 'vitest';

import {
  FrameDecoder,
  MAX_HEADER_BYTES,
  encodeFrame,
} from '../../src/protocol.ts';

const bytes = (header: unknown, payload?: Uint8Array) =>
  Buffer.concat(encodeFrame(header, payload));

describe('framing', () => {
  test('round-trips headers and payloads, however the stream is split', () => {
    const stream = Buffer.concat([
      bytes({ id: 1, result: { ok: true } }, new Uint8Array([1, 2, 3])),
      bytes({ event: 'restart', params: {} }),
      bytes({ id: 2, result: 'é' }, new Uint8Array(1000).fill(7)),
    ]);
    for (const size of [1, 7, 13, 4096]) {
      const decoder = new FrameDecoder();
      const frames = [];
      for (let offset = 0; offset < stream.length; offset += size)
        frames.push(...decoder.push(stream.subarray(offset, offset + size)));
      expect(frames.map((f) => f.header)).toEqual([
        { id: 1, result: { ok: true } },
        { event: 'restart', params: {} },
        { id: 2, result: 'é' },
      ]);
      expect([...frames[0]!.payload]).toEqual([1, 2, 3]);
      expect(frames[2]!.payload.every((byte) => byte === 7)).toBe(true);
    }
  });

  test('refuses what is not a frame', () => {
    expect(() =>
      new FrameDecoder().push(Buffer.from('plugin says hello\n')),
    ).toThrow(/bad magic/);
  });

  test('refuses oversized frames before buffering them', () => {
    const prefix = bytes({}).subarray(0, 12);
    const big = Buffer.from(prefix);
    big.writeUInt32LE(2048, 8);
    expect(() => new FrameDecoder(1024).push(big)).toThrow(
      /exceeds the limit of 1024/,
    );
    const header = Buffer.from(prefix);
    header.writeUInt32LE(MAX_HEADER_BYTES + 1, 4);
    expect(() => new FrameDecoder().push(header)).toThrow(/header/);
  });

  test('refuses a header that is not JSON', () => {
    const frame = bytes({ id: 1 });
    frame.write('{', 12 + 1);
    expect(() => new FrameDecoder().push(frame)).toThrow(/not JSON/);
  });
});
