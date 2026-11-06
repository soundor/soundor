/**
 * The glibc a Linux binary needs: the newest `GLIBC_x.y` its version
 * requirements name, read from the file itself so that a build needs no
 * binutils. x86-64 only (64-bit, little-endian), what Soundor builds on Linux.
 */

import { readFile } from 'node:fs/promises';

/** The glibc of Ubuntu 24.04, what Soundor's Linux builds are made for. */
export const LINUX_GLIBC_BASELINE = '2.39';

const SHT_GNU_VERNEED = 0x6ffffffe;

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Whether a glibc version is newer than what Soundor's builds are made for. */
export function isNewerThanBaseline(version: string): boolean {
  return compareVersions(version, LINUX_GLIBC_BASELINE) > 0;
}

function stringAt(file: Buffer, offset: number): string {
  return file.toString('latin1', offset, file.indexOf(0, offset));
}

/** The newest glibc in an ELF image's requirements; undefined if it has none. */
export function glibcRequirementOf(file: Buffer): string | undefined {
  const isElf64LittleEndian =
    file.length >= 64 &&
    file.toString('latin1', 0, 4) === '\x7fELF' &&
    file[4] === 2 &&
    file[5] === 1;
  if (!isElf64LittleEndian) return undefined;
  const sections = Number(file.readBigUInt64LE(40));
  const sectionSize = file.readUInt16LE(58);
  const sectionCount = file.readUInt16LE(60);
  const header = (index: number): number => sections + index * sectionSize;
  let newest: string | undefined;
  for (let index = 0; index < sectionCount; index += 1) {
    const section = header(index);
    if (file.readUInt32LE(section + 4) !== SHT_GNU_VERNEED) continue;
    const strings = Number(
      file.readBigUInt64LE(header(file.readUInt32LE(section + 40)) + 24),
    );
    // Elf64_Verneed, each with its Elf64_Vernaux list.
    let need = Number(file.readBigUInt64LE(section + 24));
    for (;;) {
      let aux = need + file.readUInt32LE(need + 8);
      for (let left = file.readUInt16LE(need + 2); left > 0; left -= 1) {
        const version = /^GLIBC_(\d+(?:\.\d+)*)$/.exec(
          stringAt(file, strings + file.readUInt32LE(aux + 8)),
        )?.[1];
        if (
          version !== undefined &&
          (newest === undefined || compareVersions(version, newest) > 0)
        )
          newest = version;
        const next = file.readUInt32LE(aux + 12);
        if (next === 0) break;
        aux += next;
      }
      const next = file.readUInt32LE(need + 12);
      if (next === 0) break;
      need += next;
    }
  }
  return newest;
}

/** The newest glibc any of these files needs. */
export async function glibcRequirement(
  paths: readonly string[],
): Promise<string | undefined> {
  let newest: string | undefined;
  for (const path of paths) {
    const version = glibcRequirementOf(await readFile(path));
    if (
      version !== undefined &&
      (newest === undefined || compareVersions(version, newest) > 0)
    )
      newest = version;
  }
  return newest;
}
