// node windows-plugin-check.mjs <plugin.dll> [--exports=A,B,C]: fails if a
// Windows plugin built with the static C runtime imports the C or C++ runtime
// DLLs after all, as users would then need the Redistributable that
// juceRuntime({ windows: { crt: 'MT' } }) and the VST3 runtime are there to
// avoid; with --exports, also unless it exports exactly those names.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RUNTIME = /^(vcruntime|msvcp|concrt|ucrtbase|api-ms-win-crt-)/i;

/** A 64-bit PE file's data directory `index`'s RVA, and a file offset for any RVA. */
function image(file, index) {
  if (file.toString('latin1', 0, 2) !== 'MZ') throw new Error('Not a PE file');
  const pe = file.readUInt32LE(0x3c);
  if (file.toString('latin1', pe, pe + 4) !== 'PE\0\0')
    throw new Error('Not a PE file');
  const sectionCount = file.readUInt16LE(pe + 6);
  const optionalSize = file.readUInt16LE(pe + 20);
  const optional = pe + 24;
  if (file.readUInt16LE(optional) !== 0x20b)
    throw new Error('Not a 64-bit PE file');
  // The data directories, at 112 in a PE32+ header: 8 bytes each.
  const directoryRva = file.readUInt32LE(optional + 112 + index * 8);
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const section = optional + optionalSize + index * 40;
    sections.push({
      rva: file.readUInt32LE(section + 12),
      size: Math.max(
        file.readUInt32LE(section + 8),
        file.readUInt32LE(section + 16),
      ),
      raw: file.readUInt32LE(section + 20),
    });
  }
  const offset = (rva) => {
    const section = sections.find(
      ({ rva: start, size }) => rva >= start && rva < start + size,
    );
    if (section === undefined) throw new Error(`No section holds RVA ${rva}`);
    return rva - section.rva + section.raw;
  };
  return { directoryRva, offset };
}

/** A NUL-terminated name at `rva`. */
function nameAt(file, offset, rva) {
  const start = offset(rva);
  return file.toString('latin1', start, file.indexOf(0, start));
}

/** The DLLs a 64-bit PE file imports, from its import directory (the second). */
export function importsOf(file) {
  const { directoryRva: importRva, offset } = image(file, 1);
  const names = [];
  if (importRva === 0) return names;
  // IMAGE_IMPORT_DESCRIPTOR: 20 bytes, the name's RVA at 12; all zero ends it.
  for (let entry = offset(importRva); ; entry += 20) {
    const nameRva = file.readUInt32LE(entry + 12);
    if (nameRva === 0) return names;
    names.push(nameAt(file, offset, nameRva));
  }
}

/** The names a 64-bit PE file exports, from its export directory (the first). */
export function exportsOf(file) {
  const { directoryRva: exportRva, offset } = image(file, 0);
  if (exportRva === 0) return [];
  // IMAGE_EXPORT_DIRECTORY: NumberOfNames at 24, AddressOfNames at 32.
  const directory = offset(exportRva);
  const count = file.readUInt32LE(directory + 24);
  const table = offset(file.readUInt32LE(directory + 32));
  const names = [];
  for (let index = 0; index < count; index += 1)
    names.push(nameAt(file, offset, file.readUInt32LE(table + index * 4)));
  return names;
}

export function runtimeImports(file) {
  return importsOf(file).filter((name) => RUNTIME.test(name));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  const expected = process.argv
    .slice(3)
    .find((arg) => arg.startsWith('--exports='))
    ?.slice('--exports='.length)
    .split(',');
  const file = readFileSync(path);
  const found = runtimeImports(file);
  if (found.length > 0) {
    console.error(`::error::${path} imports ${found.join(', ')}`);
    process.exit(1);
  }
  console.log(`${path} imports: ${importsOf(file).join(', ')}`);
  if (expected !== undefined) {
    const exported = exportsOf(file).sort();
    if (exported.join(',') !== [...expected].sort().join(',')) {
      console.error(
        `::error::${path} exports ${exported.join(', ') || 'nothing'}, not ${expected.join(', ')}`,
      );
      process.exit(1);
    }
    console.log(`${path} exports: ${exported.join(', ')}`);
  }
}
