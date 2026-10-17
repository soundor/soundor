/**
 * The values docs content refers to by placeholder instead of repeating them:
 *
 *   %version:<package>%   that workspace package's version
 *   %node%                the Node versions the `soundor` CLI supports
 *
 * Read from the repository when the site is built (`plugins/values.ts`). The
 * site deploys the commit a release was made from, so a version here is the
 * one on npm.
 */

export interface SiteValues {
  /** Every workspace package's version, by name. */
  readonly versions: Readonly<Record<string, string>>;
  /** The Node versions the CLI supports (its `engines.node`). */
  readonly node: string;
}

const PLACEHOLDER = /%(version:[@a-z0-9./_-]+|node)%/g;

/**
 * Replaces the placeholders in `text`. An unknown one is an error, so a typo
 * fails the build rather than reaching a page.
 */
export function fillPlaceholders(
  text: string,
  values: SiteValues,
  where: string,
): string {
  return text.replace(PLACEHOLDER, (match, name: string) => {
    if (name === 'node') return values.node;
    const pkg = name.slice('version:'.length);
    const version = values.versions[pkg];
    if (version === undefined) {
      throw new Error(`${where}: ${match} names no workspace package`);
    }
    return version;
  });
}
