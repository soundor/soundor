/**
 * The platforms the VST3 runtime builds plugins for, each on itself (no
 * cross-compilation): what the engine, the adapter, Cargo and the bundle call
 * them.
 *
 * | Target            | Engine archive              | Rust target                           | Binary in the bundle              |
 * | ----------------- | --------------------------- | ------------------------------------- | --------------------------------- |
 * | `linux-x64`       | `linux-x64` `<variant>`     | `x86_64-unknown-linux-gnu`            | `Contents/x86_64-linux/<Name>.so` |
 * | `macos-universal` | `macos-universal` `<variant>` | the machine's (`aarch64`, `x86_64`) | `Contents/MacOS/<Name>`           |
 * | `windows-x64`     | `windows-x64` `<variant>-static` | `x86_64-pc-windows-msvc`, crt-static | `Contents/x86_64-win/<Name>.vst3` |
 *
 * macOS plugins are built for the machine's architecture (as the JUCE
 * runtime's), from the universal engine and adapter. Windows plugins link the
 * static C runtime (/MT, /MTd), so they need no Visual C++ redistributable.
 */

import { EnvError } from '@soundor/runtime-sdk';

export type Vst3Target = 'linux-x64' | 'macos-universal' | 'windows-x64';
export type Variant = 'debug' | 'release';

export const VST3_TARGETS: readonly Vst3Target[] = [
  'linux-x64',
  'macos-universal',
  'windows-x64',
];

/** The target a machine builds, or undefined where the runtime builds none. */
export function hostTarget(
  platform: NodeJS.Platform,
  arch: string,
): Vst3Target | undefined {
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64'))
    return 'macos-universal';
  if (platform === 'win32' && arch === 'x64') return 'windows-x64';
  return undefined;
}

/** The target, or an error saying where the runtime builds. */
export function requireTarget(
  platform: NodeJS.Platform,
  arch: string,
): Vst3Target {
  const target = hostTarget(platform, arch);
  if (target === undefined)
    throw new EnvError(
      `The VST3 runtime builds on Linux x86_64, macOS (Apple silicon or Intel) and Windows x64, each for itself (this is ${platform} ${arch}). Use the JUCE runtime elsewhere.`,
    );
  return target;
}

/** The engine archive's variant: Windows's static C runtime ones. */
export function engineVariant(
  target: Vst3Target,
  variant: Variant,
): Variant | 'debug-static' | 'release-static' {
  return target === 'windows-x64' ? `${variant}-static` : variant;
}

/** What Cargo compiles the plugin's library for. */
export function rustTarget(target: Vst3Target, arch: string): string {
  switch (target) {
    case 'linux-x64':
      return 'x86_64-unknown-linux-gnu';
    case 'macos-universal':
      return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    case 'windows-x64':
      return 'x86_64-pc-windows-msvc';
  }
}

/** The adapter's archive in `prebuilt/<target>-<variant>/lib/`. */
export function adapterArchiveName(target: Vst3Target): string {
  return target === 'windows-x64' ? 'soundor_vst3.lib' : 'libsoundor_vst3.a';
}

/** Where users install VST3 plugins, for the build's message. */
export function installHint(target: Vst3Target): string {
  switch (target) {
    case 'linux-x64':
      return 'Copy or link it into ~/.vst3 for hosts to find it.';
    case 'macos-universal':
      return 'Copy or link it into ~/Library/Audio/Plug-Ins/VST3 for hosts to find it.';
    case 'windows-x64':
      return 'Copy it into C:\\Program Files\\Common Files\\VST3 for hosts to find it.';
  }
}
