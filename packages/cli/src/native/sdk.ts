/**
 * The Rust SDK as a project gets it: the `soundor` crate this package ships
 * (`rust/soundor`), copied by `soundor gen` into
 * `.soundor/generated/rust/soundor` with its `src/plugin.rs` generated from
 * the project's config. A project's `native/Cargo.toml` depends on it by
 * that path, so Cargo, rust-analyzer and `cargo test` work as with any path
 * dependency, with no registry and no `node_modules` layout to assume.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ResolvedSoundorConfig } from '@soundor/config';
import type { CodegenFile } from '@soundor/core';

import { cliVersion } from '../version';
import { renderPluginRs } from './codegen';

/** Where the SDK goes, within `.soundor/generated`. */
export const SDK_GENERATED_DIR = 'rust/soundor';

/** This package's copy of the SDK: from `src/native/` or the bundled `dist/`. */
export function sdkSourceDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, 'rust', 'soundor');
    if (existsSync(join(candidate, 'Cargo.toml'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error(
        'The soundor package has no Rust SDK (rust/soundor): reinstall it.',
      );
    dir = parent;
  }
}

/**
 * The SDK's files for a project, under {@link SDK_GENERATED_DIR}: its
 * sources, its manifest at this CLI's version, and `src/plugin.rs` from
 * `config`.
 */
export function rustSdkFiles(
  config: ResolvedSoundorConfig,
  sourceDir = sdkSourceDir(),
): CodegenFile[] {
  const files: CodegenFile[] = [
    {
      path: `${SDK_GENERATED_DIR}/Cargo.toml`,
      contents: readFileSync(join(sourceDir, 'Cargo.toml'), 'utf8').replace(
        /^version = "0\.0\.0"$/m,
        `version = "${cliVersion()}"`,
      ),
    },
  ];
  const sources = resolve(sourceDir, 'src');
  for (const name of readdirSync(sources).sort()) {
    if (!name.endsWith('.rs') || name === 'plugin.rs') continue;
    files.push({
      path: `${SDK_GENERATED_DIR}/src/${name}`,
      contents: readFileSync(join(sources, name), 'utf8'),
    });
  }
  files.push({
    path: `${SDK_GENERATED_DIR}/src/plugin.rs`,
    contents: renderPluginRs(config),
  });
  return files;
}
