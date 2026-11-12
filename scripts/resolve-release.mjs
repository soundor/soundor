/**
 * What the release resolves, run by `pnpm run version` after
 * `changeset version`, before the release pull request is committed:
 *
 * - a pending runtime API change (`"next"` in packages/config/runtime-api.json)
 *   ships as `released + 1`, whatever number of PRs made it, so published
 *   versions are dense one per contract-bearing release. The record advances,
 *   `packages/config/src/version.ts` and a config feature's
 *   `NEXT_API_VERSION` `since` materialize to the shipped number. A pending
 *   change ships only in a minor release before 1.0 (a major after), and only
 *   when `@soundor/config` is released in this run; otherwise it stays
 *   pending for the next one.
 * - every `@since next` annotation in doc comments becomes `@since <the
 *   package's new version>`, so the docs' version badges say what npm has.
 *
 * Nothing here hand-edits a version number: PRs record a pending change and
 * annotate new APIs with `@since next`; this script turns both into the
 * release's numbers, and the changesets action commits the result.
 */

import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `a.b.c` without a prerelease, as numbers. */
function semver(version) {
  const [major = 0, minor = 0, patch = '0'] = version.split('.');
  const [base] = patch.split('-');
  return [Number(major), Number(minor), Number(base)];
}

/**
 * Whether `next` may ship in the release that took `oldVersion` to
 * `newVersion`: a raise needs a minor bump (a major is fine too), and a
 * break needs a minor before 1.0 and a major from 1.0 on, so every copy of
 * one release line agrees on the contract.
 */
export function pendingChangeMayShip(next, oldVersion, newVersion) {
  const [oldMajor, oldMinor] = semver(oldVersion);
  const [newMajor, newMinor] = semver(newVersion);
  const minor = newMinor > oldMinor || newMajor > oldMajor;
  const major = newMajor > oldMajor;
  if (next === 'break' && newMajor >= 1) {
    if (!major)
      return `a breaking runtime API change ships in a major release from 1.0, and this release takes @soundor/config ${oldVersion} to ${newVersion}`;
    return undefined;
  }
  if (!minor)
    return `a pending runtime API change ships in a minor release (a major from 1.0), and this release takes @soundor/config ${oldVersion} to ${newVersion}`;
  return undefined;
}

/** The pending runtime API change in `packages/config/runtime-api.json`. */
export function readPendingRuntimeApi(root) {
  const path = join(root, 'packages/config/runtime-api.json');
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (
    !Number.isInteger(record.released) ||
    !Number.isInteger(record.min) ||
    (record.next !== null && record.next !== 'raise' && record.next !== 'break')
  )
    throw new Error(
      `${path} is not in the release resolver's shape: released and min are integers, next is null, "raise" or "break".`,
    );
  return record;
}

/**
 * The `@soundor/config` version HEAD has, before this release's `changeset
 * version` ran: the last published one.
 */
function headConfigVersion(root) {
  const text = execFileSync(
    'git',
    ['show', 'HEAD:packages/config/package.json'],
    { cwd: root, encoding: 'utf8' },
  );
  return JSON.parse(text).version;
}

/**
 * The version constants `src/version.ts` shows, replaced by number: the
 * literals are written by the record's test and this resolver, never by hand.
 */
function writeVersionSource(root, version, min) {
  const path = join(root, 'packages/config/src/version.ts');
  const written = readFileSync(path, 'utf8')
    .replace(
      /export const RUNTIME_API_VERSION = \d+;/,
      `export const RUNTIME_API_VERSION = ${version};`,
    )
    .replace(
      /export const MIN_RUNTIME_API_VERSION = \d+;/,
      `export const MIN_RUNTIME_API_VERSION = ${min};`,
    );
  if (
    !written.includes(`export const RUNTIME_API_VERSION = ${version};`) ||
    !written.includes(`export const MIN_RUNTIME_API_VERSION = ${min};`)
  )
    throw new Error(
      `${path} does not have the two version constants to write; restore it.`,
    );
  writeFileSync(path, written);
}

/**
 * A config feature's `since: NEXT_API_VERSION` becomes the shipped number.
 * Every use is a placeholder, so after materializing them the import goes
 * too, unless the file never had either.
 */
function materializeNextApiVersion(root, version) {
  const path = join(root, 'packages/config/src/compatibility.ts');
  const text = readFileSync(path, 'utf8');
  const importMatch = /import \{([^}]*)\} from '\.\/version';/s.exec(text);
  if (importMatch === undefined)
    throw new Error(`${path} does not import from './version'; restore it.`);
  const body =
    text.slice(0, importMatch.index) +
    text.slice(importMatch.index + importMatch[0].length);
  const uses = body.split('NEXT_API_VERSION').length - 1;
  const imports = importMatch[1]
    .split(',')
    .some((name) => name.trim() === 'NEXT_API_VERSION');
  if (uses === 0 && !imports) return;
  let importText = importMatch[0];
  if (imports) {
    // The name sits on its own line in the multi-name import.
    const line = `  NEXT_API_VERSION,\n`;
    if (!importText.includes(line))
      throw new Error(
        `${path}'s './version' import has NEXT_API_VERSION in an unexpected shape; restore it.`,
      );
    importText = importText.replace(line, '');
  }
  const replaced = body.replaceAll('NEXT_API_VERSION', String(version));
  writeFileSync(
    path,
    replaced.slice(0, importMatch.index) +
      importText +
      replaced.slice(importMatch.index),
  );
}

/** Resolves the pending runtime API change, if this release ships one. */
export function resolveRuntimeApi(root) {
  const record = readPendingRuntimeApi(root);
  if (record.next === null) return [];
  const packageJson = JSON.parse(
    readFileSync(join(root, 'packages/config/package.json'), 'utf8'),
  );
  const headVersion = headConfigVersion(root);
  if (packageJson.version === headVersion)
    return [
      `The pending runtime API ${record.next} stays: this release does not publish @soundor/config, so its version does not move.`,
    ];
  const problem = pendingChangeMayShip(
    record.next,
    headVersion,
    packageJson.version,
  );
  if (problem !== undefined) throw new Error(problem);
  const shipped = record.released + 1;
  const min = record.next === 'break' ? shipped : record.min;
  writeVersionSource(root, shipped, min);
  materializeNextApiVersion(root, shipped);
  const path = join(root, 'packages/config/runtime-api.json');
  const text = readFileSync(path, 'utf8');
  const next = JSON.stringify(record.next);
  const written = text
    .replace(/"released": \d+,/, `"released": ${shipped},`)
    .replace(/"min": \d+,/, `"min": ${min},`)
    .replace(/"next": (null|"raise"|"break"),/, '"next": null,');
  if (
    !written.includes(`"released": ${shipped},`) ||
    !written.includes(`"min": ${min},`) ||
    !written.includes('"next": null,') ||
    written.includes(`"next": ${next},`)
  )
    throw new Error(`${path} is not in the release resolver's shape.`);
  writeFileSync(path, written);
  return [
    `Runtime API ${record.released} -> ${shipped} (${record.next}); the host now runs runtime API ${min} to ${shipped}.`,
  ];
}

/** The tree a `@since next` annotation may live in, and what not to walk. */
const SKIP = new Set([
  '.git',
  '.soundor',
  '.turbo',
  '.worktrees',
  'build',
  'coverage',
  'dist',
  'node_modules',
  '__tests__',
]);

/** Source files a `@since next` annotation may live in. */
function sourceFiles(root) {
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory)) {
      if (SKIP.has(entry)) continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.(?:d\.)?tsx?$/.test(entry) && !/\.test\./.test(entry))
        files.push(path);
    }
  }
  for (const top of ['packages', 'runtimes', 'hosts', 'engines']) {
    const directory = join(root, top);
    if (statSync(directory, { throwIfNoEntry: false }) === undefined) continue;
    walk(directory);
  }
  return files;
}

/** The version of the nearest package.json, for a file's `@since` badge. */
function packageVersion(file) {
  for (
    let directory = dirname(file);
    directory !== dirname(directory);
    directory = dirname(directory)
  ) {
    try {
      return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
        .version;
    } catch {
      // No package.json at this level; the nearest is higher up.
    }
  }
  throw new Error(
    `${file} has no package.json above it to take a version from.`,
  );
}

/**
 * Every `@since next` annotation becomes `@since <the package's new
 * version>`, read from the nearest package.json, which `changeset version`
 * has already written.
 */
export function materializeSince(root) {
  const notes = [];
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, 'utf8');
    const count = text.split(/@since next(?![\w.])/).length - 1;
    if (count === 0) continue;
    const version = packageVersion(file);
    writeFileSync(
      file,
      text.replaceAll(/@since next(?![\w.])/g, `@since ${version}`),
    );
    notes.push(
      `${file}: ${count} annotation${count === 1 ? '' : 's'} -> ${version}.`,
    );
  }
  return notes;
}

function main() {
  const notes = [...resolveRuntimeApi(ROOT), ...materializeSince(ROOT)];
  if (notes.length === 0) console.log('The release has nothing to resolve.');
  else for (const note of notes) console.log(note);
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
