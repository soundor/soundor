// The content identity of the native executable: what a build of it
// depends on, and nothing else. Documentation, tests, the Node client and the
// lockfile do not change it; a source, header, protocol, CMake or dependency
// pin change does, committed or not, and a reverted edit restores it.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

import { packageRoot } from './targets.ts';

/** Files, relative to the package root. Directories are walked. */
const INPUTS = [
  'CMakeLists.txt',
  'CMakePresets.json',
  'protocol.json',
  'cmake',
  'native/src',
  'native/tools',
];
const TEXT = /\.(?:cmake|cpp|c|h|hpp|mm|m|in|json|txt)$/;
const IGNORED = /(?:^\.|~$|\.(?:swp|tmp|orig|rej)$)/;

export interface NativeInputs {
  fingerprint: string;
  files: string[];
  version: string;
}

export function nativeInputs(root = packageRoot): NativeInputs {
  const files: string[] = [];
  const visit = (relative: string) => {
    const path = join(root, relative);
    let entries;
    try {
      entries = readdirSync(path, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
        files.push(relative);
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      if (IGNORED.test(entry.name)) continue;
      const child = join(relative, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files.push(child);
      else if (entry.isSymbolicLink())
        throw new Error(`A native input is a symbolic link: ${child}`);
    }
  };
  for (const input of INPUTS) visit(input);
  const normalized = files.map((file) => file.split(sep).join('/')).sort();

  // The version is compiled in (the handshake reports it); the rest of
  // package.json is not an input.
  const { version } = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  ) as { version: string };
  const hash = createHash('sha256').update(
    `soundor-vst3-host-inputs-v1\0${version}\0`,
  );
  for (const file of normalized) {
    const bytes = readFileSync(join(root, file));
    const content = TEXT.test(file)
      ? Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))
      : bytes;
    hash.update(file).update('\0');
    hash.update(createHash('sha256').update(content).digest()).update('\0');
  }
  return { fingerprint: hash.digest('hex'), files: normalized, version };
}
