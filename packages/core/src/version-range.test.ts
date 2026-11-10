import { describe, expect, it } from 'vitest';

import {
  compareVersions,
  isValidRange,
  parseVersion,
  sameReleaseLine,
  satisfiesRange,
} from './version-range';

describe('parseVersion', () => {
  it('parses releases, prereleases and build metadata', () => {
    expect(parseVersion('0.16.0')).toEqual({
      major: 0,
      minor: 16,
      patch: 0,
      prerelease: [],
    });
    expect(parseVersion('1.2.3-next.4+sha.1')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['next', '4'],
    });
  });

  it('rejects incomplete and malformed versions', () => {
    for (const text of ['0.16', '1', 'x.y.z', '01.2.3', '1.2.3-', '', '^1.2.3'])
      expect(parseVersion(text)).toBeUndefined();
  });
});

describe('compareVersions', () => {
  const order = [
    '0.9.9',
    '0.16.0-0',
    '0.16.0-alpha',
    '0.16.0-alpha.1',
    '0.16.0-alpha.beta',
    '0.16.0-beta.2',
    '0.16.0-beta.11',
    '0.16.0',
    '0.16.1',
    '1.0.0',
  ];
  it('orders by semver precedence', () => {
    for (let i = 0; i + 1 < order.length; i++) {
      const a = parseVersion(order[i]!)!;
      const b = parseVersion(order[i + 1]!)!;
      expect(compareVersions(a, b)).toBe(-1);
      expect(compareVersions(b, a)).toBe(1);
    }
    expect(
      compareVersions(parseVersion('0.16.0')!, parseVersion('0.16.0+x')!),
    ).toBe(0);
  });
});

describe('satisfiesRange', () => {
  it.each([
    ['0.16.0', '>=0.16.0 <0.17.0', true],
    ['0.16.9', '>=0.16.0 <0.17.0', true],
    ['0.17.0', '>=0.16.0 <0.17.0', false],
    ['0.15.9', '>=0.16.0 <0.17.0', false],
    // A prerelease of the next line is not in a range that ends before it.
    ['0.17.0-next.1', '>=0.16.0 <0.17.0', false],
    ['0.17.0-next.1', '>=0.16.0 <0.17.0-next.2', true],
    ['0.16.1-next.0', '>=0.16.0 <0.17.0', true],
    ['0.17.0-next.1', '^0.16.0', false],
    ['0.16.3', '^0.16.0', true],
    ['0.17.0', '^0.16.0', false],
    ['0.0.4', '^0.0.3', false],
    ['1.9.0', '^1.2.0', true],
    ['2.0.0', '^1.2.0', false],
    ['0.16.4', '~0.16.2', true],
    ['0.17.0', '~0.16.2', false],
    ['0.16.1', '0.16.1', true],
    ['0.16.2', '=0.16.1', false],
    ['0.18.0', '>=0.16.0 <0.17.0 || >=0.18.0 <0.19.0', true],
    ['0.17.0', '>0.16.0 <=0.17.0', true],
  ])('%s in %s: %s', (version, range, expected) => {
    expect(satisfiesRange(version, range)).toBe(expected);
  });

  it('throws for what it cannot read, never matching or excluding it', () => {
    expect(() => satisfiesRange('0.16', '^0.16.0')).toThrow(TypeError);
    for (const range of [
      '',
      '0.16',
      '>=0.16',
      '*',
      '0.16.x',
      '>= 0.16.0',
      '||',
    ])
      expect(() => satisfiesRange('0.16.0', range)).toThrow(
        /not a version range/,
      );
  });

  it('isValidRange agrees', () => {
    expect(isValidRange('>=0.16.0 <0.18.0')).toBe(true);
    expect(isValidRange('^0.16.0 || ^0.17.0')).toBe(true);
    expect(isValidRange('latest')).toBe(false);
  });
});

describe('sameReleaseLine', () => {
  it('is the same minor before 1.0 and the same major after', () => {
    expect(sameReleaseLine('0.16.0', '0.16.4')).toBe(true);
    expect(sameReleaseLine('0.16.0', '0.17.0')).toBe(false);
    expect(sameReleaseLine('1.2.0', '1.9.1')).toBe(true);
    expect(sameReleaseLine('1.2.0', '2.0.0')).toBe(false);
    expect(sameReleaseLine('0.16', '0.16.0')).toBe(false);
  });
});
