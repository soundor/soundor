#!/usr/bin/env node
// Checks that every runtime in the repository declares support
// (package.json `soundor.compatibility`) for the @soundor/config and
// @soundor/core its tests run with, and for the versions the pending
// changesets will release them as, and claims no release line after that.
//
// The tests run the workspace's packages, which carry their current version
// number but already the changes of the next release: a runtime released
// with them must support both. A range open past the next line would claim
// support nobody has tested.
//
//   node .github/scripts/runtime-compatibility.mjs [repo]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseVersion,
  satisfiesRange,
} from '../../packages/core/src/version-range.ts';

const SHARED = ['@soundor/config', '@soundor/core'];
const RANK = { patch: 1, minor: 2, major: 3 };

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** `name` → { dir, manifest } of every package directly under `dirs`. */
export function workspacePackages(repo, dirs = ['packages', 'runtimes']) {
  const packages = new Map();
  for (const dir of dirs) {
    if (!existsSync(join(repo, dir))) continue;
    for (const entry of readdirSync(join(repo, dir), { withFileTypes: true })) {
      const manifestPath = join(repo, dir, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
      const manifest = readJson(manifestPath);
      packages.set(manifest.name, { dir: join(dir, entry.name), manifest });
    }
  }
  return packages;
}

/** The bump each package gets from the pending changesets, fixed groups applied. */
export function pendingBumps(repo) {
  const dir = join(repo, '.changeset');
  const bumps = new Map();
  if (!existsSync(dir)) return bumps;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md') || file === 'README.md') continue;
    const text = readFileSync(join(dir, file), 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    for (const line of frontmatter.split(/\r?\n/)) {
      const match =
        /^\s*['"]?([^'":]+)['"]?\s*:\s*(patch|minor|major)\s*$/.exec(line);
      if (match === null) continue;
      const [, name, bump] = match;
      if (RANK[bump] > (RANK[bumps.get(name)] ?? 0)) bumps.set(name, bump);
    }
  }
  const configPath = join(dir, 'config.json');
  const fixed = existsSync(configPath)
    ? (readJson(configPath).fixed ?? [])
    : [];
  for (const group of fixed) {
    const highest = group
      .map((name) => bumps.get(name))
      .filter(Boolean)
      .sort((a, b) => RANK[b] - RANK[a])[0];
    if (highest !== undefined)
      for (const name of group) bumps.set(name, highest);
  }
  return bumps;
}

/** `version` after `bump`, as Changesets computes it. */
export function bumped(version, bump) {
  const { major, minor, patch } = parseVersion(version);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  return version;
}

/** The first version of the release line after `version`'s. */
export function followingLine(version) {
  const { major, minor } = parseVersion(version);
  return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
}

/** Every problem with the runtimes' declarations; empty when they are right. */
export function check(repo) {
  const packages = workspacePackages(repo);
  const bumps = pendingBumps(repo);
  const problems = [];
  for (const [name, { dir, manifest }] of packages) {
    const compatibility = manifest.soundor?.compatibility;
    if (compatibility === undefined) continue;
    for (const shared of SHARED) {
      const key = shared.slice('@soundor/'.length);
      const range = compatibility[key];
      const where = `${dir}/package.json soundor.compatibility.${key}`;
      const source = packages.get(shared);
      if (source === undefined) continue;
      const current = source.manifest.version;
      const next = bumped(current, bumps.get(shared));
      const after = followingLine(next);
      let check;
      try {
        check = (version) => satisfiesRange(version, range);
        check(current);
      } catch (error) {
        problems.push(
          `${name}: ${where} ${JSON.stringify(range)}: ${error.message}`,
        );
        continue;
      }
      if (!check(current))
        problems.push(
          `${name}: ${where} ${JSON.stringify(range)} excludes ${shared} ${current}, which its tests run with.`,
        );
      if (next !== current && !check(next))
        problems.push(
          `${name}: ${where} ${JSON.stringify(range)} excludes ${shared} ${next}, which the pending changesets release (a ${bumps.get(shared)}). Check ${name} against it and widen the range, for example to ">=${current} <${followingLine(next)}".`,
        );
      if (check(after))
        problems.push(
          `${name}: ${where} ${JSON.stringify(range)} includes ${shared} ${after}, a line it has not been tested with. End the range before it: "<${after}".`,
        );
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repo =
    process.argv[2] ?? fileURLToPath(new URL('../..', import.meta.url));
  const problems = check(repo);
  if (problems.length > 0) {
    console.error(
      `Runtime compatibility declarations are out of date:\n${problems.map((p) => `  ${p}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log(
    'Runtime compatibility declarations cover the tested and pending versions.',
  );
}
