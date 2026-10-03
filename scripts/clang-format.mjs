#!/usr/bin/env node
// Checks or applies clang-format on Soundor-owned native sources.
//
//   node scripts/clang-format.mjs --check <dir...>
//   node scripts/clang-format.mjs --fix <dir...>
//
// Only git-tracked (or new, unignored) C/C++ files under the given directories
// are touched. Formatting output differs between clang-format majors, so the
// expected major is pinned; a mismatch is a warning locally and an error in CI.
// Without clang-format the check is skipped locally but fails in CI.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const EXPECTED_MAJOR = 18;
const EXTENSIONS = /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|mm)$/;
const inCI = Boolean(process.env.CI);

const [mode, ...dirs] = process.argv.slice(2);
if ((mode !== '--check' && mode !== '--fix') || dirs.length === 0) {
  console.error('usage: clang-format.mjs --check|--fix <dir...>');
  process.exit(2);
}

const binary = findClangFormat();
if (binary === undefined) {
  const message = `clang-format ${EXPECTED_MAJOR} not found; native formatting was not checked.`;
  if (inCI) fail(message);
  console.warn(`warning: ${message}`);
  process.exit(0);
}

const files = listFiles(dirs);
if (files.length === 0) process.exit(0);

const args =
  mode === '--check' ? ['--dry-run', '--Werror', ...files] : ['-i', ...files];
const result = spawnSync(binary.path, args, { stdio: 'inherit' });
if (result.status !== 0) {
  if (mode === '--check') {
    fail('Native sources are not formatted. Run `pnpm format:fix`.');
  }
  process.exit(result.status ?? 1);
}

function findClangFormat() {
  const candidates = [
    process.env.CLANG_FORMAT,
    `clang-format-${EXPECTED_MAJOR}`,
    'clang-format',
  ].filter(Boolean);
  for (const path of candidates) {
    const probe = spawnSync(path, ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) continue;
    const major = Number(/version (\d+)/.exec(probe.stdout)?.[1]);
    if (major !== EXPECTED_MAJOR) {
      const message = `${path} is version ${major}, expected ${EXPECTED_MAJOR}; formatting may differ from CI.`;
      if (inCI) fail(message);
      console.warn(`warning: ${message}`);
    }
    return { path, major };
  }
  return undefined;
}

function listFiles(roots) {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...roots],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) fail(`git ls-files failed: ${result.stderr}`);
  return result.stdout
    .split('\n')
    .filter((file) => EXTENSIONS.test(file) && existsSync(file))
    .sort();
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}
