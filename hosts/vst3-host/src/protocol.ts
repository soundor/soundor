// The framing both sides share (protocol.json; native/src/Ipc.h):
//
//   "SVH1" | u32 LE header length | u32 LE payload length | JSON header | payload
//
// Requests are { id, method, params }, responses { id, result } or
// { id, error: { code, message, details } }, events { event, params }.
import protocol from '../protocol.json' with { type: 'json' };

export const PROTOCOL_VERSION: number = protocol.version;
export const MAX_HEADER_BYTES: number = protocol.maxHeaderBytes;
export const DEFAULT_MAX_PAYLOAD_BYTES: number =
  protocol.defaultMaxPayloadBytes;
const MAGIC = Buffer.from(protocol.magic, 'latin1');
const PREFIX_BYTES = 12;

export interface Frame {
  header: unknown;
  payload: Buffer;
}

export function encodeFrame(
  header: unknown,
  payload: Uint8Array = new Uint8Array(0),
): Buffer[] {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.alloc(PREFIX_BYTES);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32LE(json.length, 4);
  prefix.writeUInt32LE(payload.byteLength, 8);
  return payload.byteLength > 0
    ? [
        prefix,
        json,
        Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength),
      ]
    : [prefix, json];
}

/** Turns a byte stream into frames; throws on a corrupt or oversized one,
    after which the stream cannot be read any further. */
export class FrameDecoder {
  #chunks: Buffer[] = [];
  #buffered = 0;
  #pending: { header: number; payload: number } | undefined;

  readonly maxPayloadBytes: number;
  constructor(maxPayloadBytes: number = DEFAULT_MAX_PAYLOAD_BYTES) {
    this.maxPayloadBytes = maxPayloadBytes;
  }

  push(chunk: Buffer): Frame[] {
    this.#chunks.push(chunk);
    this.#buffered += chunk.length;
    const frames: Frame[] = [];
    while (true) {
      if (this.#pending === undefined) {
        if (this.#buffered < PREFIX_BYTES) break;
        const prefix = this.#take(PREFIX_BYTES);
        if (!prefix.subarray(0, 4).equals(MAGIC))
          throw new Error(
            'the host wrote something that is not a protocol frame (bad magic)',
          );
        const header = prefix.readUInt32LE(4);
        const payload = prefix.readUInt32LE(8);
        if (header > MAX_HEADER_BYTES)
          throw new Error(
            `a frame header of ${header} bytes exceeds the limit of ${MAX_HEADER_BYTES}`,
          );
        if (payload > this.maxPayloadBytes)
          throw new Error(
            `a frame payload of ${payload} bytes exceeds the limit of ${this.maxPayloadBytes}`,
          );
        this.#pending = { header, payload };
      }
      const { header, payload } = this.#pending;
      if (this.#buffered < header + payload) break;
      this.#pending = undefined;
      const text = this.#take(header).toString('utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('the host wrote a frame whose header is not JSON');
      }
      frames.push({ header: parsed, payload: this.#take(payload) });
    }
    return frames;
  }

  #take(size: number): Buffer {
    if (size === 0) return Buffer.alloc(0);
    const first = this.#chunks[0]!;
    let result: Buffer;
    if (first.length >= size) {
      result = first.subarray(0, size);
      if (first.length === size) this.#chunks.shift();
      else this.#chunks[0] = first.subarray(size);
    } else {
      // Copied once into an aligned buffer of its own.
      result = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const chunk = this.#chunks[0]!;
        const part = Math.min(chunk.length, size - offset);
        chunk.copy(result, offset, 0, part);
        offset += part;
        if (part === chunk.length) this.#chunks.shift();
        else this.#chunks[0] = chunk.subarray(part);
      }
    }
    this.#buffered -= size;
    return result;
  }
}
