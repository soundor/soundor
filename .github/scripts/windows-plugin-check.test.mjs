import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { importsOf, runtimeImports } from './windows-plugin-check.mjs';

/** A 64-bit PE image with one section, whose imports are these DLLs. */
function peImporting(dlls) {
  const pe = 0x80;
  const optional = pe + 24;
  const optionalSize = 240;
  const section = optional + optionalSize;
  const raw = 0x400;
  const rva = 0x1000;
  const descriptors = (dlls.length + 1) * 20;
  const names = Buffer.from(dlls.map((name) => `${name}\0`).join(''), 'latin1');
  const file = Buffer.alloc(raw + descriptors + names.length);
  file.write('MZ', 0, 'latin1');
  file.writeUInt32LE(pe, 0x3c);
  file.write('PE\0\0', pe, 'latin1');
  file.writeUInt16LE(1, pe + 6);
  file.writeUInt16LE(optionalSize, pe + 20);
  file.writeUInt16LE(0x20b, optional);
  file.writeUInt32LE(rva, optional + 112 + 8);
  file.writeUInt32LE(descriptors + names.length, section + 8);
  file.writeUInt32LE(rva, section + 12);
  file.writeUInt32LE(descriptors + names.length, section + 16);
  file.writeUInt32LE(raw, section + 20);
  let name = descriptors;
  dlls.forEach((dll, index) => {
    file.writeUInt32LE(rva + name, raw + index * 20 + 12);
    name += dll.length + 1;
  });
  names.copy(file, raw + descriptors);
  return file;
}

describe('a plugin with the static C runtime', () => {
  test('imports only the system', () => {
    const file = peImporting(['KERNEL32.dll', 'USER32.dll', 'bcrypt.dll']);
    assert.deepEqual(importsOf(file), [
      'KERNEL32.dll',
      'USER32.dll',
      'bcrypt.dll',
    ]);
    assert.deepEqual(runtimeImports(file), []);
  });

  test('is caught importing the C or C++ runtime', () => {
    const file = peImporting([
      'KERNEL32.dll',
      'VCRUNTIME140.dll',
      'MSVCP140.dll',
      'VCRUNTIME140_1.dll',
      'api-ms-win-crt-runtime-l1-1-0.dll',
      'ucrtbase.dll',
    ]);
    assert.deepEqual(runtimeImports(file), [
      'VCRUNTIME140.dll',
      'MSVCP140.dll',
      'VCRUNTIME140_1.dll',
      'api-ms-win-crt-runtime-l1-1-0.dll',
      'ucrtbase.dll',
    ]);
  });

  test('refuses what is not a 64-bit PE file', () => {
    assert.throws(() => importsOf(Buffer.from('not a binary')), /Not a PE/);
  });
});
