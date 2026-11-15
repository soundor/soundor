// What engine() prepares: the WebAssembly core, or a native prebuilt target
// (the identifiers of the prebuilt release, .github/scripts/engine-prebuilts.mjs).

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The prebuilt release's native targets, as its archives name them. */
export const NATIVE_TARGETS = [
  'linux-x64',
  'windows-x64',
  'macos-universal',
] as const;
export type NativeTarget = (typeof NATIVE_TARGETS)[number];

/** `web`: the WebAssembly core (`soundor-core.wasm`), for the browser. */
export type EngineTarget = 'web' | NativeTarget;

/** Native archives: Debug or Release; on Windows also for the static C runtime. */
export const NATIVE_VARIANTS = [
  'debug',
  'release',
  'debug-static',
  'release-static',
] as const;
export type NativeVariant = (typeof NATIVE_VARIANTS)[number];

/** The web archive's variant: there is one, the Release module. */
export const WEB_VARIANT = 'release';

export function isNativeTarget(value: unknown): value is NativeTarget {
  return (NATIVE_TARGETS as readonly unknown[]).includes(value);
}

/** The native target this machine builds for, if there is a prebuilt one. */
export function hostTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): NativeTarget | undefined {
  if (platform === 'darwin') return 'macos-universal';
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'win32' && arch === 'x64') return 'windows-x64';
  return undefined;
}

/**
 * Whether <root> is the engine's source checkout (the monorepo), not an
 * installed package: wasm/ and the CMake presets are never published.
 */
export function isSourceCheckout(root: string): boolean {
  return (
    existsSync(join(root, 'wasm', 'CMakeLists.txt')) &&
    existsSync(join(root, 'CMakePresets.json'))
  );
}
