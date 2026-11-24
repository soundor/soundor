/**
 * The Rust SDK as a project gets it: the `soundor` crate this package ships
 * (`rust/soundor`), copied by `soundor gen` into
 * `.soundor/generated/rust/soundor` with its `src/plugin.rs` generated from
 * the project's config. A project's `lib/Cargo.toml` depends on it by
 * that path, so Cargo, rust-analyzer and `cargo test` work as with any path
 * dependency, with no registry and no `node_modules` layout to assume.
 *
 * Its manifest keeps the source's `version = "0.0.0"`: a path dependency's
 * version resolves nothing, and one that followed the CLI's would rewrite
 * every project's `Cargo.lock` at each release. What the SDK is, for its
 * notice, is {@link rustSdk}'s version: this CLI's.
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

/** A project's SDK: its generated manifest, and the version it is (this CLI's). */
export function rustSdk(root: string): { manifest: string; version: string } {
  return {
    manifest: resolve(
      root,
      '.soundor',
      'generated',
      SDK_GENERATED_DIR,
      'Cargo.toml',
    ),
    version: sdkVersion(),
  };
}

function sdkVersion(): string {
  const version = cliVersion();
  if (version === undefined)
    throw new Error('The soundor package has no version: reinstall it.');
  return version;
}

/** This package's copy of the SDK: from `src/library/` or the bundled `dist/`. */
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
 * sources and manifest as shipped, its `LICENSE` (the notice a
 * plugin linking it ships), and `src/plugin.rs` from `config`.
 */
export function rustSdkFiles(
  config: ResolvedSoundorConfig,
  sourceDir = sdkSourceDir(),
): CodegenFile[] {
  const files: CodegenFile[] = [
    {
      path: `${SDK_GENERATED_DIR}/Cargo.toml`,
      contents: readFileSync(join(sourceDir, 'Cargo.toml'), 'utf8'),
    },
    {
      path: `${SDK_GENERATED_DIR}/LICENSE`,
      contents: readFileSync(join(sourceDir, 'LICENSE'), 'utf8'),
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
