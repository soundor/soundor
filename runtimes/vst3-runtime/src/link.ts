/**
 * Linking a plugin: the prebuilt adapter, the plugin's Rust library and the
 * prebuilt engine, into one shared object, by the system's C++ compiler
 * driver (`c++`: g++ or clang++; Rust links with the C one on Linux too).
 * Nothing is compiled here.
 *
 * - The adapter is linked whole (--whole-archive): it is the plugin's
 *   classes and entry points, which nothing in the link references.
 * - The Rust library resolves what the adapter asks of the plugin
 *   (soundor_vst3_plugin, and soundor::export!'s processor, controller and
 *   MIDI functions); the link fails, naming them, when it does not.
 * - The engine's libraries follow, in the order engine() gives them.
 * - The C++ runtime is linked statically, every static library's symbols but
 *   the adapter's are hidden (--exclude-libs; the adapter's are hidden where
 *   it is compiled, but its entry points), and the version script exports
 *   only VST3's three entry points: several Soundor plugins, of any
 *   versions, share a host.
 * - System libraries by soname (fontconfig, FreeType, GIO), so linking needs
 *   no development packages: those the engine needs at run time, as the
 *   JUCE runtime's plugins do; X11 and the GPU's are loaded at run time.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { EnvError } from '@soundor/runtime-sdk';

/** What a plugin binary exports: VST3's entry points, nothing else. */
export const VERSION_SCRIPT = `{
    global:
        GetPluginFactory;
        ModuleEntry;
        ModuleExit;
    local:
        *;
};
`;

/** Libraries the engine links on Linux beside its archives (SoundorPlatformLibraries.cmake). */
export const SYSTEM_LIBRARIES = [
  '-l:libfontconfig.so.1',
  '-l:libfreetype.so.6',
  '-l:libgio-2.0.so.0',
  '-l:libgobject-2.0.so.0',
  '-l:libglib-2.0.so.0',
];

/** The static C++ and compiler runtimes the driver links. */
export const STATIC_RUNTIME = [
  'libstdc++.a',
  'libgcc.a',
  'libgcc_eh.a',
  'libsupc++.a',
];

/** What Rust's standard library needs (rustc --print native-static-libs, less the unwinder libgcc provides). */
export const RUST_LIBRARIES = [
  '-lpthread',
  '-ldl',
  '-lm',
  '-lrt',
  '-lutil',
  '-lc',
];

export interface LinkInputs {
  readonly output: string;
  readonly versionScript: string;
  readonly adapter: string;
  readonly rust: string;
  readonly engineLibraries: readonly string[];
  readonly engineFlags: readonly string[];
  readonly release: boolean;
  /** Extra flags, such as the environment's LDFLAGS. */
  readonly extra?: readonly string[];
}

/** The compiler driver's arguments for a plugin's link. */
export function linkArguments(inputs: LinkInputs): string[] {
  return [
    '-shared',
    '-o',
    inputs.output,
    ...(inputs.extra ?? []),
    '-static-libstdc++',
    '-static-libgcc',
    '-Wl,--no-undefined',
    '-Wl,--as-needed',
    // Every static library's symbols hidden, but the adapter's: its entry
    // points are its only default-visibility symbols, which the version
    // script then exports.
    `-Wl,--exclude-libs,${[inputs.rust, ...inputs.engineLibraries]
      .map((library) => basename(library))
      .concat(STATIC_RUNTIME)
      .join(':')}`,
    '-Wl,-z,noexecstack',
    `-Wl,--version-script=${inputs.versionScript}`,
    ...(inputs.release ? ['-Wl,--gc-sections', '-Wl,--strip-debug'] : []),
    '-Wl,--whole-archive',
    inputs.adapter,
    '-Wl,--no-whole-archive',
    inputs.rust,
    '-Wl,--start-group',
    ...inputs.engineLibraries,
    '-Wl,--end-group',
    ...SYSTEM_LIBRARIES,
    ...inputs.engineFlags,
    ...RUST_LIBRARIES,
  ];
}

/** The C++ compiler driver, which links the C++ runtime: CXX, else `c++`. */
export function compilerDriver(env: NodeJS.ProcessEnv = process.env): string {
  return env['CXX']?.trim() || 'c++';
}

/** LDFLAGS as arguments (whitespace-separated, as make reads them). */
export function environmentLinkFlags(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return (env['LDFLAGS'] ?? '').split(/\s+/).filter((flag) => flag.length > 0);
}

/** What `adapter.json` says of a prebuilt adapter. */
export interface AdapterMetadata {
  readonly format: number;
  readonly runtimeVersion: string;
  readonly target: string;
  readonly variant: 'debug' | 'release';
  readonly engine: {
    readonly version: string;
    readonly sourceFingerprint?: string;
    readonly abiNamespace?: string;
  };
}

/**
 * The prebuilt adapter for `variant`: the archive, checked against the
 * engine the plugin links (an adapter compiled against other engine headers
 * would misread its classes).
 */
export async function findAdapter(
  packageRoot: string,
  variant: 'debug' | 'release',
  engine: {
    readonly version: string;
    readonly sourceFingerprint: string | undefined;
  },
): Promise<string> {
  const directory = join(packageRoot, 'prebuilt', `linux-x64-${variant}`);
  const archive = join(directory, 'lib', 'libsoundor_vst3.a');
  const metadataFile = join(directory, 'adapter.json');
  if (!existsSync(archive) || !existsSync(metadataFile))
    throw new EnvError(
      `The VST3 runtime's prebuilt ${variant} adapter is missing (${archive}). An installed @soundor/vst3-runtime ships it; in Soundor's workspace, build it with \`pnpm --filter @soundor/vst3-runtime build:native\`.`,
    );
  const metadata = JSON.parse(
    await readFile(metadataFile, 'utf8'),
  ) as AdapterMetadata;
  if (
    metadata.format !== 1 ||
    metadata.target !== 'linux-x64' ||
    metadata.variant !== variant
  )
    throw new EnvError(
      `${metadataFile} is not a linux-x64 ${variant} adapter this runtime reads.`,
    );
  if (
    metadata.engine.version !== engine.version ||
    (metadata.engine.sourceFingerprint !== undefined &&
      engine.sourceFingerprint !== undefined &&
      metadata.engine.sourceFingerprint !== engine.sourceFingerprint)
  )
    throw new EnvError(
      `The VST3 runtime's ${variant} adapter was built against another engine (${metadata.engine.version}, ${metadata.engine.sourceFingerprint ?? 'unknown inputs'}) than the one this plugin links (${engine.version}, ${engine.sourceFingerprint ?? 'unknown inputs'}). In Soundor's workspace, build it again with \`pnpm --filter @soundor/vst3-runtime build:native\`.`,
    );
  return archive;
}
