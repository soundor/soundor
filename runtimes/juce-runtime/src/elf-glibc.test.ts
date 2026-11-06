import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  glibcRequirement,
  glibcRequirementOf,
  isNewerThanBaseline,
} from './elf-glibc';

/** An ELF image with one .gnu.version_r, one library needing these versions. */
function elfNeeding(versions: readonly string[]): Buffer {
  const names = Buffer.from(`\0${versions.join('\0')}\0`, 'latin1');
  const nameOffset = (index: number): number =>
    versions.slice(0, index).reduce((sum, name) => sum + name.length + 1, 1);
  const needSize = 16;
  const auxSize = 16;
  const requirements = Buffer.alloc(needSize + versions.length * auxSize);
  requirements.writeUInt16LE(1, 0);
  requirements.writeUInt16LE(versions.length, 2);
  requirements.writeUInt32LE(needSize, 8);
  versions.forEach((_, index) => {
    const aux = needSize + index * auxSize;
    requirements.writeUInt32LE(nameOffset(index), aux + 8);
    if (index + 1 < versions.length)
      requirements.writeUInt32LE(auxSize, aux + 12);
  });
  const headerSize = 64;
  const sectionSize = 64;
  const stringsAt = headerSize + 2 * sectionSize;
  const requirementsAt = stringsAt + names.length;
  const header = Buffer.alloc(headerSize + 2 * sectionSize);
  header.write('\x7fELF', 0, 'latin1');
  header[4] = 2;
  header[5] = 1;
  header.writeBigUInt64LE(BigInt(headerSize), 40);
  header.writeUInt16LE(sectionSize, 58);
  header.writeUInt16LE(2, 60);
  header.writeUInt32LE(3, headerSize + 4); // SHT_STRTAB
  header.writeBigUInt64LE(BigInt(stringsAt), headerSize + 24);
  const verneed = headerSize + sectionSize;
  header.writeUInt32LE(0x6ffffffe, verneed + 4);
  header.writeBigUInt64LE(BigInt(requirementsAt), verneed + 24);
  header.writeUInt32LE(0, verneed + 40);
  return Buffer.concat([header, names, requirements]);
}

describe('glibcRequirementOf', () => {
  it('takes the newest, comparing versions as numbers', () => {
    expect(
      glibcRequirementOf(
        elfNeeding(['GLIBC_2.9', 'GLIBC_2.39', 'GLIBC_2.2.5', 'GLIBC_2.4']),
      ),
    ).toBe('2.39');
  });

  it("ignores other libraries' versions", () => {
    expect(
      glibcRequirementOf(
        elfNeeding(['GLIBCXX_3.4.32', 'GLIBC_2.34', 'CXXABI_1.3.13']),
      ),
    ).toBe('2.34');
    expect(
      glibcRequirementOf(elfNeeding(['GLIBC_PRIVATE', 'GLIBCXX_3.4'])),
    ).toBeUndefined();
  });

  it('has nothing to say about what is not a 64-bit ELF file', () => {
    expect(glibcRequirementOf(Buffer.from('not a binary'))).toBeUndefined();
    expect(glibcRequirementOf(Buffer.alloc(0))).toBeUndefined();
  });

  it.runIf(process.platform === 'linux')('reads a real binary', async () => {
    expect(glibcRequirementOf(await readFile(process.execPath))).toMatch(
      /^2\.\d+/,
    );
  });
});

describe('glibcRequirement', () => {
  it.runIf(process.platform === 'linux')(
    'takes the newest of several files',
    async () => {
      const node = glibcRequirementOf(await readFile(process.execPath));
      expect(await glibcRequirement([process.execPath])).toBe(node);
    },
  );
});

describe('isNewerThanBaseline', () => {
  it.each([
    ['2.35', false],
    ['2.39', false],
    ['2.4', false],
    ['2.40', true],
    ['2.43', true],
    ['3.0', true],
  ])('%s: %s', (version, newer) => {
    expect(isNewerThanBaseline(version)).toBe(newer);
  });
});
