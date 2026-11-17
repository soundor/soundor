// Reads a prebuilt archive (a gzipped ustar, as engine-prebuilts.mjs packs
// it) in memory: regular files only, every path inside one top directory.
// Nothing an archive says can write outside where it is extracted.

import { gunzipSync } from 'node:zlib';

export interface TarEntry {
  /** Relative to the archive's top directory, with "/". */
  readonly path: string;
  readonly data: Buffer;
  readonly executable: boolean;
}

function field(block: Buffer, offset: number, length: number): string {
  return block.toString('utf8', offset, offset + length).split('\0')[0]!;
}

function octal(block: Buffer, offset: number, length: number): number {
  const text = block
    .toString('ascii', offset, offset + length)
    .replaceAll('\0', '')
    .trim();
  const value = text === '' ? 0 : Number.parseInt(text, 8);
  if (!/^[0-7]*$/.test(text) || !Number.isSafeInteger(value))
    throw new Error('Invalid archive header');
  return value;
}

/** PAX records ("<length> key=value\n"): the path is the one Soundor writes. */
function pax(data: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  for (let offset = 0; offset < data.length;) {
    const space = data.indexOf(0x20, offset);
    const length = Number(data.toString('ascii', offset, space));
    if (space < 0 || !Number.isSafeInteger(length) || length <= 0)
      throw new Error('Invalid archive extended header');
    const record = data.toString('utf8', space + 1, offset + length - 1);
    const equals = record.indexOf('=');
    records.set(record.slice(0, equals), record.slice(equals + 1));
    offset += length;
  }
  return records;
}

/**
 * The files of the archive whose one top directory is <top>. Throws on
 * anything else: links, devices, absolute or escaping paths, other tops.
 */
export function readArchive(
  archive: Uint8Array,
  top: string,
  maxSize = 1024 * 1024 * 1024,
): TarEntry[] {
  const tar = gunzipSync(archive, { maxOutputLength: maxSize });
  const entries: TarEntry[] = [];
  const seen = new Set<string>();
  let longPath: string | undefined;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = octal(header, 124, 12);
    const start = offset + 512;
    if (start + size > tar.length) throw new Error('Truncated archive');
    const data = tar.subarray(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
    const type = String.fromCharCode(header[156]!);
    if (type === 'x') {
      longPath = pax(data).get('path');
      continue;
    }
    if (type === 'g') continue; // Global records describe nothing we use.
    const prefix =
      field(header, 257, 6) === 'ustar' ? field(header, 345, 155) : '';
    const name =
      longPath ??
      (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    longPath = undefined;
    if (type === '5') continue; // Directories are made for the files in them.
    if (type !== '0' && type !== '\0')
      throw new Error(`The archive holds ${name}, which is not a regular file`);
    const parts = name.split('/');
    if (
      parts[0] !== top ||
      parts.length < 2 ||
      parts
        .slice(1)
        .some((part) => part === '' || part === '.' || part === '..') ||
      name.includes('\\')
    )
      throw new Error(`The archive holds ${name}, outside ${top}/`);
    const path = parts.slice(1).join('/');
    if (seen.has(path)) throw new Error(`The archive holds ${name} twice`);
    seen.add(path);
    entries.push({
      path,
      data: Buffer.from(data),
      executable: (octal(header, 100, 8) & 0o111) !== 0,
    });
  }
  return entries;
}
