/**
 * Linking a plugin: the prebuilt adapter, the plugin's Rust library and the
 * prebuilt engine, into one shared object. Nothing is compiled here.
 *
 * - Linux: the system's C++ compiler driver (`c++`: g++ or clang++; Rust
 *   links with the C one there too), below.
 * - macOS: `c++` too (Apple's clang++, from the Command Line Tools Rust
 *   needs), `-bundle`, exporting VST3's three entry points alone
 *   (`-exported_symbols_list`); see {@link macLinkArguments}.
 * - Windows: MSVC's `link.exe` (Visual Studio or its Build Tools, which Rust
 *   needs too), found with vswhere; see {@link windowsLinkArguments}.
 *
 * On Linux:
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
 *   no development packages: those the engine needs at run time; X11 and the GPU's are loaded at run time.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

// ── macOS ──────────────────────────────────────────────────────────────────

/** What a macOS plugin exports (macexport.exp, the SDK's): nothing else. */
export const MAC_EXPORTS = '_GetPluginFactory\n_bundleEntry\n_bundleExit\n';

/**
 * The frameworks the adapter and the engine need on macOS: the engine's
 * beside its archives' (SoundorPlatformLibraries.cmake: the runtime's, Skia's
 * and Hermes's, which its metadata leaves to CMake), and the adapter's.
 */
export const MAC_FRAMEWORKS = [
  '-framework',
  'CoreFoundation',
  '-framework',
  'Foundation',
  '-framework',
  'AppKit',
  '-framework',
  'QuartzCore',
  '-framework',
  'CoreGraphics',
  '-framework',
  'CoreText',
  '-framework',
  'ImageIO',
];

/**
 * The engine's link flags as the driver takes them: its metadata lists
 * Hermes's frameworks as system libraries ("-framework CoreFoundation"),
 * which engine() makes `-l-framework CoreFoundation`.
 */
export function macEngineFlags(flags: readonly string[]): string[] {
  return flags.flatMap((flag) => {
    const framework = /^-l-framework\s+(.+)$/.exec(flag);
    return framework ? ['-framework', framework[1]!] : [flag];
  });
}

/** What Rust's standard library needs on macOS (rustc --print native-static-libs). */
export const MAC_RUST_LIBRARIES = ['-liconv', '-lSystem', '-lc', '-lm'];

export interface MacLinkInputs extends Omit<LinkInputs, 'versionScript'> {
  /** The exported symbols list ({@link MAC_EXPORTS}). */
  readonly exportsList: string;
  /** `arm64` or `x86_64`: the machine's. */
  readonly architecture: 'arm64' | 'x86_64';
  /** The engine's minimum macOS version (its `target.minimumOsVersion`). */
  readonly minimumOs: string;
}

/**
 * clang++'s arguments for a macOS plugin: a bundle (a Mach-O loadable
 * module), the adapter loaded whole (-force_load), only VST3's entry points
 * exported, so plugins of any versions share a host (two-level namespaces
 * and hosts' RTLD_LOCAL keep the rest apart).
 */
export function macLinkArguments(inputs: MacLinkInputs): string[] {
  return [
    '-bundle',
    '-o',
    inputs.output,
    '-arch',
    inputs.architecture,
    `-mmacosx-version-min=${inputs.minimumOs}`,
    ...(inputs.extra ?? []),
    `-Wl,-exported_symbols_list,${inputs.exportsList}`,
    ...(inputs.release ? ['-Wl,-dead_strip', '-Wl,-S'] : []),
    `-Wl,-force_load,${inputs.adapter}`,
    inputs.rust,
    ...inputs.engineLibraries,
    ...macEngineFlags(inputs.engineFlags),
    ...MAC_FRAMEWORKS,
    ...MAC_RUST_LIBRARIES,
  ];
}

// ── Windows ────────────────────────────────────────────────────────────────

/**
 * The system libraries the adapter and the engine need on Windows: the
 * engine's beside its archives' (SoundorPlatformLibraries.cmake: the
 * runtime's and Skia's, which its metadata leaves to CMake), and the
 * adapter's.
 */
export const WINDOWS_LIBRARIES = [
  'kernel32.lib',
  'user32.lib',
  'gdi32.lib',
  'comctl32.lib',
  'ole32.lib',
  'oleaut32.lib',
  'shell32.lib',
  'bcrypt.lib',
  'winhttp.lib',
  'uiautomationcore.lib',
  'imm32.lib',
  'dwrite.lib',
  'usp10.lib',
  'fontsub.lib',
];

/** What Rust's standard library needs on Windows (rustc --print native-static-libs). */
export const WINDOWS_RUST_LIBRARIES = [
  'advapi32.lib',
  'ntdll.lib',
  'userenv.lib',
  'ws2_32.lib',
  'dbghelp.lib',
];

export interface WindowsLinkInputs extends Omit<LinkInputs, 'versionScript'> {
  /** The system's library directories (LIB, from vcvars64.bat). */
  readonly libraryPaths: readonly string[];
  /** Debug builds: where the PDB goes. */
  readonly pdb?: string;
}

/**
 * link.exe's arguments for a Windows plugin: a DLL with the adapter linked
 * whole (/WHOLEARCHIVE), whose dllexport'ed entry points (GetPluginFactory,
 * InitDll, ExitDll: SMTG_EXPORT_SYMBOL) are the only exports. Everything is
 * compiled for the static C runtime; a Debug build's objects (/MTd) and
 * Rust's standard library (libcmt) name two of them, and the debug one wins.
 */
export function windowsLinkArguments(inputs: WindowsLinkInputs): string[] {
  return [
    '/NOLOGO',
    '/DLL',
    '/MACHINE:X64',
    '/INCREMENTAL:NO',
    `/OUT:${inputs.output}`,
    ...inputs.libraryPaths.map((path) => `/LIBPATH:${path}`),
    ...(inputs.release
      ? ['/OPT:REF', '/OPT:ICF']
      : [
          '/DEBUG:FULL',
          ...(inputs.pdb !== undefined ? [`/PDB:${inputs.pdb}`] : []),
          '/NODEFAULTLIB:libcmt.lib',
          '/NODEFAULTLIB:libvcruntime.lib',
          '/NODEFAULTLIB:libucrt.lib',
          '/NODEFAULTLIB:libcpmt.lib',
        ]),
    ...(inputs.extra ?? []),
    `/WHOLEARCHIVE:${inputs.adapter}`,
    inputs.adapter,
    inputs.rust,
    ...inputs.engineLibraries,
    ...inputs.engineFlags,
    ...WINDOWS_LIBRARIES,
    ...WINDOWS_RUST_LIBRARIES,
  ];
}

/** A response file's contents: one argument a line, quoted. */
export function responseFile(args: readonly string[]): string {
  return `${args.map((arg) => `"${arg.replaceAll('"', '\\"')}"`).join('\r\n')}\r\n`;
}

/** MSVC's linker and the system's library directories. */
export interface MsvcLinker {
  readonly linker: string;
  readonly libraryPaths: readonly string[];
  /** Where it came from, for logs and `soundor doctor`. */
  readonly source: string;
}

/** vswhere's path: the Visual Studio Installer's, at a fixed place. */
function vswherePath(env: NodeJS.ProcessEnv): string {
  const programs =
    env['ProgramFiles(x86)'] ??
    env['ProgramFiles'] ??
    'C:\\Program Files (x86)';
  return join(programs, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
}

function linkerOf(toolsDir: string): string {
  return join(toolsDir, 'bin', 'Hostx64', 'x64', 'link.exe');
}

function libraryPathsOf(lib: string | undefined): string[] {
  return (lib ?? '').split(';').filter((path) => path.length > 0);
}

/**
 * The libraries every Windows plugin links that Visual Studio's C++ tools
 * alone do not guarantee: the Windows SDK's, the Universal C runtime's (both
 * a separate component of the installer), and MSVC's static C runtime.
 */
const WINDOWS_TOOLCHAIN_LIBRARIES = [
  {
    file: 'kernel32.lib',
    what: 'the Windows SDK',
    fix: 'add a "Windows 11 SDK" (or Windows 10 SDK) to Visual Studio or its Build Tools, in the Visual Studio Installer',
  },
  {
    file: 'libucrt.lib',
    what: "the Universal C runtime (the Windows SDK's)",
    fix: 'add a "Windows 11 SDK" (or Windows 10 SDK) to Visual Studio or its Build Tools, in the Visual Studio Installer',
  },
  {
    file: 'libcmt.lib',
    what: "MSVC's static C runtime",
    fix: 'repair "Desktop development with C++" (MSVC x64/x86 build tools) in the Visual Studio Installer',
  },
] as const;

/**
 * What the linker's library paths lack of the Windows SDK and the C
 * runtimes, as one message, or undefined when nothing is missing.
 */
export function windowsLibraryProblem(
  libraryPaths: readonly string[],
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const missing = WINDOWS_TOOLCHAIN_LIBRARIES.filter(
    ({ file }) => !libraryPaths.some((path) => exists(join(path, file))),
  );
  if (missing.length === 0) return undefined;
  const fixes = [...new Set(missing.map((library) => library.fix))];
  return `${missing.map(({ file, what }) => `${file} (${what})`).join(', ')} not found in the linker's library paths (${libraryPaths.join('; ') || 'none'}): ${fixes.join('; ')}.`;
}

/**
 * Finds link.exe: the developer prompt's (VCToolsInstallDir and LIB set),
 * else the newest Visual Studio or Build Tools with the C++ x64 tools
 * (vswhere), whose vcvars64.bat says where the libraries are.
 */
export function findMsvcLinker(
  env: NodeJS.ProcessEnv = process.env,
): MsvcLinker {
  const tools = env['VCToolsInstallDir'];
  if (tools !== undefined && tools !== '' && env['LIB'] !== undefined)
    return {
      linker: linkerOf(tools),
      libraryPaths: libraryPathsOf(env['LIB']),
      source: `the developer environment (${tools})`,
    };
  const vswhere = vswherePath(env);
  if (!existsSync(vswhere))
    throw new EnvError(
      'Visual Studio was not found (no vswhere.exe). Install Visual Studio 2022 or later, or its Build Tools, with "Desktop development with C++": it links the plugin, and Rust needs it too.',
    );
  const found = spawnSync(
    vswhere,
    [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ],
    { encoding: 'utf8' },
  );
  const installation = (found.stdout ?? '').trim().split(/\r?\n/)[0] ?? '';
  if (found.status !== 0 || installation === '')
    throw new EnvError(
      'No Visual Studio with the C++ x64 build tools was found. Add "Desktop development with C++" to Visual Studio or its Build Tools.',
    );
  const vcvars = join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  const shown = spawnSync(
    env['ComSpec'] ?? 'cmd.exe',
    ['/d', '/s', '/c', `""${vcvars}" >nul && set"`],
    { encoding: 'utf8', windowsVerbatimArguments: true },
  );
  const variables = new Map<string, string>();
  for (const line of (shown.stdout ?? '').split(/\r?\n/)) {
    const equals = line.indexOf('=');
    if (equals > 0)
      variables.set(
        line.slice(0, equals).toUpperCase(),
        line.slice(equals + 1),
      );
  }
  const vcTools = variables.get('VCTOOLSINSTALLDIR');
  if (shown.status !== 0 || vcTools === undefined)
    throw new EnvError(
      `${vcvars} did not set up the C++ build tools: repair the Visual Studio installation.`,
    );
  return {
    linker: linkerOf(vcTools),
    libraryPaths: libraryPathsOf(variables.get('LIB')),
    source: installation,
  };
}
