/**
 * Reviewed template compatibility, independent of the versions recorded at
 * build time. Keep a minimum until the template needs a newer API. Raise
 * only the affected group; its current workspace version is the upper bound.
 * CLI/config/React belong to Changesets' fixed release group.
 */
export const TEMPLATE_RELEASE_GROUPS: readonly ReleaseGroup[] = [
  {
    packages: ['soundor', '@soundor/config', '@soundor/react'],
    minimum: '0.15.0',
  },
  { packages: ['@soundor/juce-runtime'], minimum: '0.14.0' },
  { packages: ['@soundor/web-runtime'], minimum: '0.11.0' },
  { packages: ['@soundor/vst3-host'], minimum: '0.0.0' },
];

export interface ReleaseGroup {
  readonly packages: readonly string[];
  readonly minimum: string;
}

/** Only stable releases are fallback candidates. */
export function stableVersion(version: string): readonly number[] | undefined {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    return undefined;
  }
  return version.split('.').map(Number);
}

export function compareVersions(a: string, b: string): number {
  const left = stableVersion(a);
  const right = stableVersion(b);
  if (!left || !right) throw new Error(`Expected stable versions: ${a}, ${b}`);
  for (let i = 0; i < 3; i++) {
    const difference = left[i]! - right[i]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

export function activeReleaseGroups(
  versions: Readonly<Record<string, string>>,
  groups: readonly ReleaseGroup[] = TEMPLATE_RELEASE_GROUPS,
): ReleaseGroup[] {
  return groups.flatMap((group) => {
    const packages = group.packages.filter((name) => name in versions);
    if (packages.length === 0) return [];
    const golden = versions[packages[0]!]!;
    if (compareVersions(group.minimum, golden) > 0) {
      throw new Error(
        `Template minimum ${group.minimum} exceeds ${packages[0]}@${golden}`,
      );
    }
    for (const name of packages) {
      if (versions[name] !== golden) {
        throw new Error(
          `Template release group has different golden versions: ${packages.join(', ')}`,
        );
      }
    }
    return [{ ...group, packages }];
  });
}
