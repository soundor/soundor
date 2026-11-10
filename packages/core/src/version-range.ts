/**
 * Versions and version ranges, as far as Soundor's compatibility declarations
 * need them. Self-contained (no imports), so tooling outside the build, such
 * as the repository's CI scripts, can load this file directly.
 *
 * A version is `MAJOR.MINOR.PATCH`, optionally with a `-prerelease` and a
 * `+build` part (ignored). A range is one or more comparator sets joined by
 * `||`; a set is comparators separated by spaces, all of which must hold:
 * `>=0.16.0 <0.17.0`, `^0.16.0`, `~0.16.2`, `0.16.1` (exactly), `=`, `>`,
 * `>=`, `<`, `<=`. Every version in a comparator is complete: `0.16` and
 * wildcards are not ranges here. `^` follows npm: `^0.16.0` is
 * `>=0.16.0 <0.17.0`, `^1.2.0` is `>=1.2.0 <2.0.0`. `<0.17.0` also excludes
 * the prereleases of 0.17.0, which already have its changes.
 */

/** A parsed version. */
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Dot-separated prerelease identifiers; empty for a release. */
  readonly prerelease: readonly string[];
}

type Operator = '<' | '<=' | '>' | '>=' | '=';

interface Comparator {
  readonly operator: Operator;
  readonly version: Version;
}

const VERSION =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Parses `0.16.0`, or returns `undefined` for anything else. */
export function parseVersion(text: string): Version | undefined {
  const match = VERSION.exec(text.trim());
  if (match === null) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/** Orders two versions by semver precedence: negative, zero or positive. */
export function compareVersions(a: Version, b: Version): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core !== 0) return Math.sign(core);
  // A release is greater than any of its prereleases.
  if (a.prerelease.length === 0 || b.prerelease.length === 0)
    return Math.sign(b.prerelease.length - a.prerelease.length);
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return Math.sign(Number(x) - Number(y));
    if (xNumeric) return -1;
    if (yNumeric) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Parses a range into its comparator sets, or returns `undefined` when it is
 * not one this module understands.
 */
function parseRange(range: string): Comparator[][] | undefined {
  const sets: Comparator[][] = [];
  for (const part of range.split('||')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return undefined;
    const set: Comparator[] = [];
    for (const token of tokens) {
      const comparators = parseComparator(token);
      if (comparators === undefined) return undefined;
      set.push(...comparators);
    }
    sets.push(set);
  }
  return sets;
}

function parseComparator(token: string): Comparator[] | undefined {
  const match = /^(\^|~|<=|>=|<|>|=)?(.+)$/.exec(token);
  if (match === null) return undefined;
  const version = parseVersion(match[2]!);
  if (version === undefined) return undefined;
  const operator = match[1] ?? '=';
  switch (operator) {
    case '^': {
      const upper =
        version.major > 0
          ? { major: version.major + 1, minor: 0, patch: 0 }
          : version.minor > 0
            ? { major: 0, minor: version.minor + 1, patch: 0 }
            : { major: 0, minor: 0, patch: version.patch + 1 };
      return [
        { operator: '>=', version },
        { operator: '<', version: { ...upper, prerelease: ['0'] } },
      ];
    }
    case '~':
      return [
        { operator: '>=', version },
        {
          operator: '<',
          version: {
            major: version.major,
            minor: version.minor + 1,
            patch: 0,
            prerelease: ['0'],
          },
        },
      ];
    case '<':
      // `<0.17.0` excludes 0.17.0's prereleases too: they have its content.
      return [
        {
          operator: '<',
          version:
            version.prerelease.length === 0
              ? { ...version, prerelease: ['0'] }
              : version,
        },
      ];
    default:
      return [{ operator: operator as Operator, version }];
  }
}

function holds(version: Version, comparator: Comparator): boolean {
  const order = compareVersions(version, comparator.version);
  switch (comparator.operator) {
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
    case '=':
      return order === 0;
  }
}

/** Whether `range` is a range {@link satisfiesRange} understands. */
export function isValidRange(range: string): boolean {
  return parseRange(range) !== undefined;
}

/**
 * Whether `version` is in `range`. Throws a `TypeError` for a version or a
 * range that does not parse: an unreadable declaration is never treated as a
 * match or a mismatch.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  if (parsed === undefined)
    throw new TypeError(`'${version}' is not a version (MAJOR.MINOR.PATCH)`);
  const sets = parseRange(range);
  if (sets === undefined)
    throw new TypeError(
      `'${range}' is not a version range (such as '>=0.16.0 <0.17.0' or '^0.16.0')`,
    );
  return sets.some((set) =>
    set.every((comparator) => holds(parsed, comparator)),
  );
}

/**
 * Whether two versions are on the same release line: the same major, and
 * before 1.0 the same minor too, since a 0.x minor may break.
 */
export function sameReleaseLine(a: string, b: string): boolean {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (x === undefined || y === undefined) return false;
  return x.major === y.major && (x.major > 0 || x.minor === y.minor);
}
