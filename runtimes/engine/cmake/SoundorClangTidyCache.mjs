// Runs clang-tidy as CMake's CXX_CLANG_TIDY does, but only for a translation
// unit it has not passed before: a pass is remembered under a hash of
// everything its result depends on, and replayed (its output included) the
// next time. A failure is never remembered, so it is reported every time.
//
//   node SoundorClangTidyCache.mjs <cache dir> <clang-tidy> [<args>...] <source> -- <compiler> <flags>...
//
// The hash covers clang-tidy's version, its arguments, the configuration it
// applies to <source> (--dump-config: the nearest .clang-tidy files, merged)
// and <source> preprocessed with the same flags, so every header it includes.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [cacheDir, tidy, ...rest] = process.argv.slice(2);
const separator = rest.indexOf('--');
if (cacheDir === undefined || tidy === undefined || separator < 1) {
  console.error(
    'usage: node SoundorClangTidyCache.mjs <cache dir> <clang-tidy> [<args>...] <source> -- <compiler> <flags>...',
  );
  process.exit(2);
}
const tidyArgs = rest.slice(0, separator);
const [compiler, ...flags] = rest.slice(separator + 1);

function output(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'buffer',
    maxBuffer: 1 << 30,
  });
  return result.status === 0 ? result.stdout : null;
}

// The compile command preprocessing to stdout: without its object file and the
// dependency file the build writes (-MD/-MF...), which -E would overwrite.
function preprocessFlags(flags) {
  const kept = [];
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (['-o', '-MF', '-MT', '-MQ'].includes(flag)) i++;
    else if (!['-c', '-MD', '-MMD'].includes(flag)) kept.push(flag);
  }
  return [...kept, '-E'];
}

function key() {
  const version = output(tidy, ['--version']);
  const config = output(tidy, ['--dump-config', ...tidyArgs]);
  const preprocessed = output(compiler, preprocessFlags(flags));
  if (version === null || config === null || preprocessed === null) return null;
  const hash = createHash('sha256');
  for (const part of [version, JSON.stringify(tidyArgs), config, preprocessed])
    hash.update(part).update('\0');
  return hash.digest('hex');
}

function run() {
  const result = spawnSync(tidy, [...tidyArgs, '--', compiler, ...flags], {
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 1 << 30,
  });
  process.stdout.write(result.stdout ?? '');
  return result;
}

const hash = key();
const entry = hash && join(cacheDir, hash.slice(0, 2), `${hash}.out`);
if (entry) {
  try {
    process.stdout.write(readFileSync(entry));
    process.exit(0);
  } catch {
    // Not passed before: run it.
  }
}
const result = run();
if (result.status === 0 && entry) {
  mkdirSync(dirname(entry), { recursive: true });
  const temporary = `${entry}.${process.pid}`;
  writeFileSync(temporary, result.stdout ?? '');
  renameSync(temporary, entry);
}
process.exit(result.status ?? 1);
