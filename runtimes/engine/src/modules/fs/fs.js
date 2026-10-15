// soundor:fs — asynchronous file access confined to the plugin's private data
// directory. Paths are relative ('presets/warm.json'); there is no way to name
// a file outside that directory.

import { fsOperation } from 'soundor:internal/platform';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function path(value) {
  if (typeof value !== 'string')
    throw new TypeError('soundor:fs paths must be strings');
  return value;
}

/** The file's bytes. */
export function readBytes(file) {
  return fsOperation('readBytes', path(file), null, false);
}

/** The file's contents, decoded as UTF-8. */
export async function readText(file) {
  return decoder.decode(await readBytes(file));
}

/** Replaces the file atomically, creating missing parent directories. */
export function writeBytes(file, data) {
  if (!(data instanceof ArrayBuffer || ArrayBuffer.isView(data))) {
    throw new TypeError('writeBytes() expects an ArrayBuffer or a typed array');
  }
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return fsOperation('writeBytes', path(file), bytes, false);
}

/** Writes `text` as UTF-8, atomically. */
export function writeText(file, text) {
  return fsOperation(
    'writeBytes',
    path(file),
    encoder.encode(String(text)),
    false,
  );
}

/** The directory's entries ({ name, kind }), sorted by name. */
export function readDir(directory = '.') {
  return fsOperation('readDir', path(directory), null, false);
}

export function mkdir(directory, options = {}) {
  return fsOperation(
    'mkdir',
    path(directory),
    null,
    Boolean(options.recursive),
  );
}

/** Removes a file, or a directory (which must be empty unless `recursive`). */
export function remove(target, options = {}) {
  return fsOperation('remove', path(target), null, Boolean(options.recursive));
}

/** { kind, size, modified } of an entry, or null if it does not exist. */
export function stat(target) {
  return fsOperation('stat', path(target), null, false);
}

export async function exists(target) {
  return (await stat(target)) !== null;
}
