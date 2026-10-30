// Writes the test fonts in assets/: tiny TrueType fonts made here (no third
// party's glyphs), whose every printable ASCII character is a box of a known
// width, so tests can tell which face set a text by its width alone.
//
//   node tests/fixtures/images/make-fonts.mjs
//
// box-regular.ttf: weight 400, each box 1 em wide.
// box-bold.ttf:    weight 700, each box 1.5 em wide.
// The space is half an em in both. Glyphs stand on the baseline, 0.7 em
// tall, with a twentieth of an em clear on either side.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNITS = 1000;
const ASCENT = 800;
const DESCENT = 200;
const FIRST = 0x21;
const LAST = 0x7e;

class Writer {
  bytes = [];
  u8(value) {
    this.bytes.push(value & 0xff);
    return this;
  }
  u16(value) {
    return this.u8(value >> 8).u8(value);
  }
  i16(value) {
    return this.u16(value & 0xffff);
  }
  u32(value) {
    return this.u16(value >>> 16).u16(value & 0xffff);
  }
  raw(bytes) {
    for (const byte of bytes) this.u8(byte);
    return this;
  }
  pad() {
    while (this.bytes.length % 4 !== 0) this.u8(0);
    return this;
  }
  get length() {
    return this.bytes.length;
  }
}

function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4)
    sum =
      (sum +
        (((bytes[i] ?? 0) << 24) |
          ((bytes[i + 1] ?? 0) << 16) |
          ((bytes[i + 2] ?? 0) << 8) |
          (bytes[i + 3] ?? 0))) >>>
      0;
  return sum;
}

function utf16(text) {
  const out = [];
  for (const char of text)
    out.push(char.charCodeAt(0) >> 8, char.charCodeAt(0) & 0xff);
  return out;
}

function font({ family, style, weight, advance, space }) {
  const glyphCount = 2 + (LAST - FIRST + 1); // .notdef, space, the boxes
  const margin = UNITS / 20;
  const top = (UNITS * 7) / 10;
  const advances = [UNITS / 2, space, ...Array(LAST - FIRST + 1).fill(advance)];

  // glyf: empty .notdef and space, then one box per character.
  const box = new Writer()
    .i16(1)
    .i16(margin)
    .i16(0)
    .i16(advance - margin)
    .i16(top)
    .u16(3) // the contour's last point
    .u16(0) // no instructions
    .raw([1, 1, 1, 1]) // on-curve points, coordinates as 16-bit deltas
    .i16(margin)
    .i16(advance - 2 * margin)
    .i16(0)
    .i16(-(advance - 2 * margin))
    .i16(0)
    .i16(0)
    .i16(top)
    .i16(0)
    .pad().bytes;
  const glyf = new Writer();
  const loca = new Writer();
  for (let glyph = 0; glyph < glyphCount; glyph++) {
    loca.u32(glyf.length);
    if (glyph >= 2) glyf.raw(box);
  }
  loca.u32(glyf.length);

  const hmtx = new Writer();
  for (const width of advances) hmtx.u16(width).i16(margin);

  const head = new Writer()
    .u32(0x00010000)
    .u32(0x00010000)
    .u32(0) // checkSumAdjustment, set last
    .u32(0x5f0f3cf5)
    .u16(0x000b)
    .u16(UNITS)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .i16(margin)
    .i16(0)
    .i16(advance - margin)
    .i16(top)
    .u16((weight >= 700 ? 1 : 0) | (style === 'italic' ? 2 : 0))
    .u16(8)
    .i16(2)
    .i16(1) // long loca
    .i16(0);

  const hhea = new Writer()
    .u32(0x00010000)
    .i16(ASCENT)
    .i16(-DESCENT)
    .i16(0)
    .u16(Math.max(...advances))
    .i16(0)
    .i16(margin)
    .i16(advance - margin)
    .i16(1)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .u16(glyphCount);

  const maxp = new Writer().u32(0x00010000).u16(glyphCount).u16(4).u16(1);
  // The composite limits, maxZones (2), then the hinting limits: none.
  for (let i = 0; i < 11; i++) maxp.u16(i === 2 ? 2 : 0);

  // cmap: one format 4 subtable, for Unicode and Windows Unicode BMP.
  const segments = [
    [0x20, 0x20, 1 - 0x20],
    [FIRST, LAST, 2 - FIRST],
    [0xffff, 0xffff, 1],
  ];
  const segCount = segments.length;
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segCount));
  const format4 = new Writer()
    .u16(4)
    .u16(16 + 8 * segCount)
    .u16(0)
    .u16(2 * segCount)
    .u16(searchRange)
    .u16(Math.log2(searchRange / 2))
    .u16(2 * segCount - searchRange);
  for (const [, end] of segments) format4.u16(end);
  format4.u16(0);
  for (const [start] of segments) format4.u16(start);
  for (const [, , delta] of segments) format4.i16(delta);
  for (let i = 0; i < segCount; i++) format4.u16(0);
  const cmap = new Writer()
    .u16(0)
    .u16(2)
    .u16(0)
    .u16(3)
    .u32(20)
    .u16(3)
    .u16(1)
    .u32(20)
    .raw(format4.bytes);

  const subfamily = weight >= 700 ? 'Bold' : 'Regular';
  const names = [
    [1, family],
    [2, subfamily],
    [3, `${family} ${subfamily}`],
    [4, `${family} ${subfamily}`],
    [6, `${family.replaceAll(' ', '')}-${subfamily}`],
  ];
  const strings = new Writer();
  const name = new Writer()
    .u16(0)
    .u16(names.length)
    .u16(6 + 12 * names.length);
  for (const [id, text] of names) {
    const encoded = utf16(text);
    name
      .u16(3)
      .u16(1)
      .u16(0x409)
      .u16(id)
      .u16(encoded.length)
      .u16(strings.length);
    strings.raw(encoded);
  }
  name.raw(strings.bytes);

  const os2 = new Writer().u16(4).i16(advance).u16(weight).u16(5).u16(0);
  for (let i = 0; i < 10; i++) os2.i16(UNITS / 2); // sub- and superscript sizes and offsets
  os2
    .i16(50)
    .i16(300)
    .i16(0)
    .raw(Array(10).fill(0))
    .u32(1) // Basic Latin
    .u32(0)
    .u32(0)
    .u32(0)
    .raw([...'NONE'].map((char) => char.charCodeAt(0)))
    .u16(weight >= 700 ? 0x20 : 0x40)
    .u16(0x20)
    .u16(LAST)
    .i16(ASCENT)
    .i16(-DESCENT)
    .i16(0)
    .u16(ASCENT)
    .u16(DESCENT)
    .u32(1) // Latin 1
    .u32(0)
    .i16(UNITS / 2)
    .i16(top)
    .u16(0)
    .u16(0x20)
    .u16(0);

  const post = new Writer().u32(0x00030000).u32(0).i16(-100).i16(50);
  for (let i = 0; i < 5; i++) post.u32(0);

  const tables = {
    'OS/2': os2.bytes,
    cmap: cmap.bytes,
    glyf: glyf.bytes,
    head: head.bytes,
    hhea: hhea.bytes,
    hmtx: hmtx.bytes,
    loca: loca.bytes,
    maxp: maxp.bytes,
    name: name.bytes,
    post: post.bytes,
  };
  const tags = Object.keys(tables).sort();
  const out = new Writer();
  const tableSearch = 16 * 2 ** Math.floor(Math.log2(tags.length));
  out
    .u32(0x00010000)
    .u16(tags.length)
    .u16(tableSearch)
    .u16(Math.log2(tableSearch / 16))
    .u16(16 * tags.length - tableSearch);
  let offset = 12 + 16 * tags.length;
  for (const tag of tags) {
    const bytes = tables[tag];
    out
      .raw([...tag].map((char) => char.charCodeAt(0)))
      .u32(checksum(bytes))
      .u32(offset)
      .u32(bytes.length);
    offset += Math.ceil(bytes.length / 4) * 4;
  }
  let headAt = 0;
  for (const tag of tags) {
    if (tag === 'head') headAt = out.length;
    out.raw(tables[tag]).pad();
  }
  const bytes = Uint8Array.from(out.bytes);
  const adjustment = (0xb1b0afba - checksum(bytes)) >>> 0;
  new DataView(bytes.buffer).setUint32(headAt + 8, adjustment);
  return bytes;
}

const assets = join(dirname(fileURLToPath(import.meta.url)), 'assets');
const family = 'Soundor Box';
writeFileSync(
  join(assets, 'box-regular.ttf'),
  font({
    family,
    style: 'normal',
    weight: 400,
    advance: UNITS,
    space: UNITS / 2,
  }),
);
writeFileSync(
  join(assets, 'box-bold.ttf'),
  font({
    family,
    style: 'normal',
    weight: 700,
    advance: (UNITS * 3) / 2,
    space: UNITS / 2,
  }),
);
