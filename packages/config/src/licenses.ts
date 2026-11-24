/**
 * `licenses`: what the build cannot find on its own about third-party
 * notices. Runtimes gather the notices of everything a build contains
 * (`@soundor/core`'s notices); this adds notices for what they cannot see
 * and replaces, or drops, the one found for a package or crate.
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import type { LicenseOverride, ResolvedLicenses } from '@soundor/core';
import { z } from 'zod';

import type { ConfigIssue } from './errors';

/** A license the config gives a package or crate. */
export interface LicenseOverrideConfig {
  /** Its license, as an SPDX expression (`MIT`, `Apache-2.0 OR MIT`). */
  license: string;
  /** The license text, from the config's directory. */
  file: string;
}

/** A notice for something the build cannot see. */
export interface AddedLicenseConfig {
  /** What it is, as listed; also its folder under `licenses/project/`. */
  name: string;
  /** Its license, as an SPDX expression. */
  license: string;
  /** The license text, from the config's directory. */
  file: string;
}

/**
 * Third-party notices: the build ships those of everything it contains in
 * `licenses/`, found on its own. This is for what it cannot find.
 */
export interface LicensesConfig {
  /**
   * Notices for what the build cannot see: samples or impulse responses
   * loaded at run time, data a crate embeds, code copied into the project.
   */
  add?: AddedLicenseConfig[];
  /**
   * By npm package name: the license of a package whose notice is missing
   * or wrong, for every version in the build; `false` ships no notice for
   * it (a private package of your own, never someone else's code).
   */
  packages?: Record<string, LicenseOverrideConfig | false>;
  /** As `packages`, by Rust crate name; `std` is Rust's standard library. */
  crates?: Record<string, LicenseOverrideConfig | false>;
}

const spdx = z.string().trim().min(1, 'expected an SPDX license expression');
const file = z.string().trim().min(1, 'expected the path of a license text');
const override = z.union([
  z.literal(false),
  z.strictObject({ license: spdx, file }),
]);

export const licensesSchema = z.strictObject({
  add: z
    .array(
      z.strictObject({
        name: z
          .string()
          .trim()
          .min(1, 'expected a name')
          .refine(
            (name) => !/[/\\\0]/.test(name) && name !== '.' && name !== '..',
            {
              message: 'a name is a folder of licenses/project/: no slashes',
            },
          ),
        license: spdx,
        file,
      }),
    )
    .optional(),
  packages: z.record(z.string().min(1), override).optional(),
  crates: z.record(z.string().min(1), override).optional(),
});

function checkFile(
  path: string,
  at: string,
  root: string,
  issues: ConfigIssue[],
): string {
  const absolute = resolve(root, path);
  let ok = false;
  try {
    ok = existsSync(absolute) && statSync(absolute).isFile();
  } catch {
    ok = false;
  }
  if (!ok) issues.push({ path: at, message: `no such file: ${absolute}` });
  return absolute;
}

/** The config's `licenses`, its files resolved from `root` and checked. */
export function resolveLicenses(
  data: z.infer<typeof licensesSchema> | undefined,
  root: string,
  issues: ConfigIssue[],
): ResolvedLicenses {
  const overrides = (
    entries: Record<string, LicenseOverrideConfig | false> | undefined,
    path: string,
  ): Record<string, LicenseOverride | false> =>
    Object.fromEntries(
      Object.entries(entries ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, entry]) => [
          name,
          entry === false
            ? false
            : {
                license: entry.license,
                file: checkFile(
                  entry.file,
                  `${path}.${name}.file`,
                  root,
                  issues,
                ),
              },
        ]),
    );
  const names = new Set<string>();
  const add = (data?.add ?? []).map((entry, index) => {
    if (names.has(entry.name))
      issues.push({
        path: `licenses.add[${index}].name`,
        message: `'${entry.name}' is added twice`,
      });
    names.add(entry.name);
    return {
      name: entry.name,
      license: entry.license,
      file: checkFile(entry.file, `licenses.add[${index}].file`, root, issues),
    };
  });
  return {
    add,
    packages: overrides(data?.packages, 'licenses.packages'),
    crates: overrides(data?.crates, 'licenses.crates'),
  };
}
