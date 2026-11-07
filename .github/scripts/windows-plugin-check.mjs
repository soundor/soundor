// node windows-plugin-check.mjs <plugin.dll>: fails if a Windows plugin built
// with the static C runtime imports the C or C++ runtime DLLs after all, as users
// would then need the Redistributable that juceRuntime({ windows: { crt: 'MT' } })
// is there to avoid.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RUNTIME = /^(vcruntime|msvcp|concrt|ucrtbase|api-ms-win-crt-)/i;

/** The DLLs a 64-bit PE file imports, from its import directory. */
export function importsOf(file) {
  if (file.toString('latin1', 0, 2) !== 'MZ') throw new Error('Not a PE file');
  const pe = file.readUInt32LE(0x3c);
  if (file.toString('latin1', pe, pe + 4) !== 'PE\0\0')
    throw new Error('Not a PE file');
  const sectionCount = file.readUInt16LE(pe + 6);
  const optionalSize = file.readUInt16LE(pe + 20);
  const optional = pe + 24;
  if (file.readUInt16LE(optional) !== 0x20b)
    throw new Error('Not a 64-bit PE file');
  // The second entry of the data directories, at 112 in a PE32+ header.
  const importRva = file.readUInt32LE(optional + 112 + 8);
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
  const names = [];
  if (importRva === 0) return names;
  // IMAGE_IMPORT_DESCRIPTOR: 20 bytes, the name's RVA at 12; all zero ends it.
  for (let entry = offset(importRva); ; entry += 20) {
    const nameRva = file.readUInt32LE(entry + 12);
    if (nameRva === 0) return names;
    const start = offset(nameRva);
    names.push(file.toString('latin1', start, file.indexOf(0, start)));
  }
}

export function runtimeImports(file) {
  return importsOf(file).filter((name) => RUNTIME.test(name));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  const file = readFileSync(path);
  const found = runtimeImports(file);
  if (found.length > 0) {
    console.error(`::error::${path} imports ${found.join(', ')}`);
    process.exit(1);
  }
  console.log(`${path} imports: ${importsOf(file).join(', ')}`);
}
