/**
 * `@soundor/vst3-runtime`: Soundor plugins as VST3 plugins for Linux, macOS
 * and Windows.
 *
 * A plugin is linked from parts built once, never compiled per plugin: the
 * prebuilt VST3 adapter (`libsoundor_vst3.a`: Steinberg's SDK and a generic
 * component, controller and editor), the prebuilt Soundor engine (this
 * package's exact `@soundor/engine`), and the project's Rust crate compiled
 * by Cargo with this package's `soundor-vst3` crate, which tells the adapter
 * which plugin it is (the descriptor, the UI). See the docs' `vst3-runtime.md`.
 */

import { existsSync } from 'node:fs';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { engine, type NativeEngineArtifact } from '@soundor/engine';
import {
  defineRuntime,
  describeController,
  describeNativeApi,
  describeState,
  EnvError,
  probeCommand,
  runCommand,
  type CommandProbe,
  type CommandRunner,
  type DoctorReport,
  type LifecycleContext,
  type ResolvedSoundorConfig,
} from '@soundor/runtime-sdk';
import {
  launchHost,
  prepareHost,
  resolveHost,
  type Vst3Host,
} from '@soundor/vst3-host';

import { adapterDirectory, adapterManifest, resolveAdapter } from './adapter';
import { bundlePaths, writeBundleResources } from './bundle';
import { buildCrate, writeCrate } from './crate';
import { describePlugin, descriptorJson } from './descriptor';
import {
  compilerDriver,
  environmentLinkFlags,
  findMsvcLinker,
  linkArguments,
  MAC_EXPORTS,
  macLinkArguments,
  responseFile,
  VERSION_SCRIPT,
  windowsLinkArguments,
  type MsvcLinker,
} from './link';
import { resolveVst3Options, type Vst3Options } from './options';
import {
  adapterArchiveName,
  engineVariant,
  hostTarget,
  installHint,
  requireTarget,
  rustTarget,
  type Variant,
  type Vst3Target,
} from './targets';
import { embeddedFiles, watchNativeUi, writeNativeUi } from './ui';

export type { Vst3Options, ResolvedVst3Options } from './options';
export {
  classIds,
  describePlugin,
  descriptorJson,
  parameterVstId,
} from './descriptor';
export {
  linkArguments,
  macLinkArguments,
  windowsLinkArguments,
  VERSION_SCRIPT,
} from './link';
export { infoPlist, moduleInfo } from './bundle';
export { hostTarget, type Vst3Target } from './targets';

/** The runtime id: `soundor build vst3`. */
export const RUNTIME_ID = 'vst3';

/** This package's root (above dist/ or src/). */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

type Ctx = LifecycleContext<Vst3Options>;

/** Injectable for tests. */
export interface Vst3PhaseDeps {
  readonly run?: CommandRunner;
  readonly probe?: CommandProbe;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly engine?: (variant: Variant) => Promise<NativeEngineArtifact>;
  /** Whether a file exists (doctor's system library checks). */
  readonly exists?: (path: string) => boolean;
  /** Windows: finds MSVC's linker. */
  readonly msvc?: () => MsvcLinker;
  /** Finds the prebuilt adapter (adapter.ts). */
  readonly adapter?: typeof resolveAdapter;
}

/** Where Linux distributions keep x86_64 libraries. */
const LIBRARY_DIRECTORIES = [
  '/usr/lib/x86_64-linux-gnu',
  '/lib/x86_64-linux-gnu',
  '/usr/lib64',
  '/lib64',
  '/usr/lib',
];

function machine(deps: Vst3PhaseDeps): {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly target: Vst3Target;
} {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  return { platform, arch, target: requireTarget(platform, arch) };
}

/** `gen`: the descriptor, for inspection and `gen --check`; builds make it again. */
async function vst3Gen(config: ResolvedSoundorConfig, ctx: Ctx): Promise<void> {
  ctx.codegen.emit({
    path: 'descriptor.json',
    contents: descriptorJson(config, resolveVst3Options(ctx.options)),
  });
}

interface BuildOptions {
  readonly variant: Variant;
  /** Where the bundle goes. */
  readonly out: string;
  /** The cache subdirectory for this kind of build. */
  readonly label: string;
  /** Close the dev host once Cargo succeeds, before replacing its bundle. */
  readonly beforeReplace?: () => Promise<void>;
  /** A development build: its UI is read from this directory, its log written there. */
  readonly live?: { readonly uiDirectory: string; readonly logFile: string };
}

/** What an engine archive's soundor-engine.json says that a plugin build reads. */
async function engineMetadata(artifact: NativeEngineArtifact): Promise<{
  readonly hermesRevision: string;
  readonly minimumOs: string | undefined;
}> {
  const metadata = JSON.parse(
    await readFile(join(artifact.directory, 'soundor-engine.json'), 'utf8'),
  ) as {
    hermes?: { revision?: string };
    target?: { minimumOsVersion?: string };
  };
  const revision = metadata.hermes?.revision;
  if (revision === undefined)
    throw new EnvError(
      `${artifact.directory} does not name its Hermes revision.`,
    );
  return {
    hermesRevision: revision,
    minimumOs: metadata.target?.minimumOsVersion,
  };
}

async function buildPlugin(
  config: ResolvedSoundorConfig,
  ctx: Ctx,
  build: BuildOptions,
  deps: Vst3PhaseDeps,
): Promise<string> {
  const { arch, target } = machine(deps);
  if (ctx.lib === undefined)
    throw new EnvError(
      "The project has no Rust library (lib/Cargo.toml), which holds the plugin's processor and controller. Run `soundor gen` to create missing Rust starter files.",
    );
  const options = resolveVst3Options(ctx.options);
  const run = deps.run ?? runCommand;
  const cache = join(ctx.paths.cache, build.label);
  const artifact = await (
    deps.engine ??
    ((variant: Variant) =>
      engine({ target, variant: engineVariant(target, variant) }))
  )(build.variant);
  ctx.logger.info(
    `Engine: ${artifact.version} ${artifact.variant} for ${target} (${artifact.mode}: ${artifact.reason})`,
  );
  const adapter = await (deps.adapter ?? resolveAdapter)(
    PACKAGE_ROOT,
    target,
    build.variant,
    artifact,
    { log: (message) => ctx.logger.info(message) },
  );
  ctx.logger.info(
    `Adapter: ${build.variant} for ${target} (${adapter.reason})`,
  );
  const metadata = await engineMetadata(artifact);

  // The UI, in the engine's form; embedded unless a live build reads it.
  const uiDir = join(cache, 'ui');
  if (build.live === undefined) {
    await rm(uiDir, { recursive: true, force: true });
    if (ctx.ui !== undefined)
      await writeNativeUi(
        ctx.ui,
        uiDir,
        build.variant === 'release' ? 'production' : 'development',
        build.variant === 'release'
          ? {
              hermesc: artifact.hermesc,
              revision: metadata.hermesRevision,
            }
          : undefined,
      );
    else
      ctx.logger.warn(
        'The project has no UI entry (src/main.ts[x]); the plugin view will be empty.',
      );
  }

  const description = describePlugin(config, options);
  const native = describeNativeApi(config.native);
  if (!native.ok)
    throw new EnvError(
      'Invalid native API: run `soundor gen` for the details.',
    );
  const crateDir = join(cache, 'crate');
  await writeCrate(crateDir, {
    libManifest: ctx.lib.manifest,
    packageRoot: PACKAGE_ROOT,
    descriptor: `${JSON.stringify(description)}\n`,
    controllerDescriptor: describeController(
      native.model,
      describeState(config.state, config.native),
      config.parameters.length,
    ),
    files: build.live === undefined ? await embeddedFiles(uiDir) : [],
    uiDirectory: build.live?.uiDirectory ?? '',
    logFile: build.live?.logFile ?? '',
  });
  ctx.logger.info(
    `Compiling the plugin's Rust library (lib/) with Cargo (${build.variant})`,
  );
  const rust = await buildCrate({
    dir: crateDir,
    projectRoot: ctx.paths.root,
    targetDir: join(ctx.paths.cache, 'target'),
    profile: build.variant,
    target: rustTarget(target, arch),
    logger: ctx.logger,
    signal: ctx.signal,
  });

  await build.beforeReplace?.();
  ctx.signal.throwIfAborted();
  const paths = bundlePaths(build.out, config.plugin.name, target);
  await rm(paths.bundle, { recursive: true, force: true });
  await mkdir(paths.binaryDir, { recursive: true });
  ctx.logger.info('Linking the plugin');
  const minimumOs = metadata.minimumOs ?? '12.0';
  await linkPlugin({
    target,
    arch,
    cache,
    ctx,
    run,
    deps,
    inputs: {
      output: paths.binary,
      adapter: adapter.archive,
      rust,
      engineLibraries: artifact.libraries,
      engineFlags: artifact.linkFlags,
      release: build.variant === 'release',
      extra: environmentLinkFlags(),
    },
    minimumOs,
  });
  await writeBundleResources({
    paths,
    description,
    ...(target === 'macos-universal' ? { macos: { minimumOs } } : {}),
    licenses: [
      {
        name: 'vst3sdk',
        directory: join(adapter.directory, 'licenses', 'vst3sdk'),
      },
      {
        name: 'soundor-engine',
        directory: join(artifact.directory, 'licenses'),
      },
    ],
  });
  // macOS: signed last, as nothing may write into a bundle after it.
  if (target === 'macos-universal') {
    const { identity, keychain } = ctx.signing.macos;
    ctx.logger.info(
      `Signing the bundle (${identity === '-' ? 'ad-hoc' : identity})`,
    );
    await run({
      cmd: 'codesign',
      args: [
        '--force',
        '--sign',
        identity,
        ...(keychain !== undefined ? ['--keychain', keychain] : []),
        // Notarization requires the hardened runtime and a secure timestamp.
        ...(identity !== '-' ? ['--options', 'runtime', '--timestamp'] : []),
        paths.bundle,
      ],
      cwd: ctx.paths.root,
      logger: ctx.logger,
      signal: ctx.signal,
    });
    await run({
      cmd: 'codesign',
      args: ['--verify', '--deep', '--strict', paths.bundle],
      cwd: ctx.paths.root,
      logger: ctx.logger,
      signal: ctx.signal,
    });
  }
  return paths.bundle;
}

/** Links the plugin's binary, with the platform's linker (link.ts). */
async function linkPlugin(options: {
  readonly target: Vst3Target;
  readonly arch: string;
  readonly cache: string;
  readonly ctx: Ctx;
  readonly run: CommandRunner;
  readonly deps: Vst3PhaseDeps;
  readonly inputs: {
    readonly output: string;
    readonly adapter: string;
    readonly rust: string;
    readonly engineLibraries: readonly string[];
    readonly engineFlags: readonly string[];
    readonly release: boolean;
    readonly extra: readonly string[];
  };
  readonly minimumOs: string;
}): Promise<void> {
  const { ctx, run, cache, inputs } = options;
  const command = {
    cwd: ctx.paths.root,
    logger: ctx.logger,
    signal: ctx.signal,
  };
  await mkdir(cache, { recursive: true });
  switch (options.target) {
    case 'linux-x64': {
      const versionScript = join(cache, 'exports.map');
      await writeFile(versionScript, VERSION_SCRIPT);
      await run({
        cmd: compilerDriver(),
        args: linkArguments({ ...inputs, versionScript }),
        ...command,
      });
      return;
    }
    case 'macos-universal': {
      const exportsList = join(cache, 'exports.txt');
      await writeFile(exportsList, MAC_EXPORTS);
      await run({
        cmd: compilerDriver(),
        args: macLinkArguments({
          ...inputs,
          exportsList,
          architecture: options.arch === 'arm64' ? 'arm64' : 'x86_64',
          minimumOs: options.minimumOs,
        }),
        ...command,
      });
      return;
    }
    case 'windows-x64': {
      const msvc = (options.deps.msvc ?? findMsvcLinker)();
      ctx.logger.info(`MSVC: ${msvc.source}`);
      // LDFLAGS are the GNU drivers'; link.exe reads its own LINK variable.
      const args = windowsLinkArguments({
        ...inputs,
        extra: [],
        libraryPaths: msvc.libraryPaths,
        ...(inputs.release ? {} : { pdb: join(cache, 'plugin.pdb') }),
      });
      // A response file, read in the cache: the command line stays short
      // and needs no quoting by the shell.
      await writeFile(join(cache, 'link.rsp'), responseFile(args));
      await run({
        cmd: `"${msvc.linker}"`,
        args: ['@link.rsp'],
        cwd: cache,
        logger: ctx.logger,
        signal: ctx.signal,
      });
      return;
    }
  }
}

/**
 * `build`: the release bundle, under `.soundor/dist/vst3`; with `--debug`, a
 * Debug build with DevTools and its UI embedded.
 */
async function vst3Build(
  config: ResolvedSoundorConfig,
  ctx: Ctx,
  deps: Vst3PhaseDeps = {},
): Promise<void> {
  const debug = ctx.mode === 'debug';
  const bundle = await buildPlugin(
    config,
    ctx,
    debug
      ? { variant: 'debug', out: ctx.paths.dist, label: 'debug' }
      : { variant: 'release', out: ctx.paths.dist, label: 'release' },
    deps,
  );
  ctx.logger.info(
    `${debug ? 'Debug VST3 (with DevTools)' : 'VST3'} in ${bundle}. ${installHint(machine(deps).target)}`,
  );
}

/** `value` for a POSIX shell. */
function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/** `dev`: opens a Debug build with live UI reload and rebuilds when lib/ changes. */
async function vst3Dev(
  config: ResolvedSoundorConfig,
  ctx: Ctx,
  deps: Vst3PhaseDeps = {},
): Promise<void> {
  const { target } = machine(deps);
  const uiDirectory = join(ctx.paths.cache, 'dev', 'ui');
  const live = ctx.ui?.live;
  const watcher =
    live === undefined || ctx.ui === undefined
      ? undefined
      : watchNativeUi({ ...ctx.ui, live }, uiDirectory, (error) =>
          ctx.logger.error(
            `The UI could not be prepared for the plugin; it keeps the last good one.\n${error instanceof Error ? error.message : String(error)}`,
          ),
        );
  let stopWatching: (() => void) | undefined;
  let host: Vst3Host | undefined;
  let reopen = false;
  let pending = Promise.resolve();
  const enqueue = (action: () => Promise<void>): Promise<void> => {
    const next = pending.then(async () => {
      if (!ctx.signal.aborted) await action();
    });
    pending = next.catch(() => {});
    return next;
  };
  const closeHost = async (): Promise<void> => {
    const current = host;
    host = undefined;
    await current?.close();
  };
  try {
    if (live === undefined && ctx.ui !== undefined)
      await writeNativeUi(ctx.ui, uiDirectory, 'development');
    await watcher?.ready;
    const build = (): Promise<string> =>
      buildPlugin(
        config,
        ctx,
        {
          variant: 'debug',
          out: join(ctx.paths.cache, 'dev', 'bundle'),
          label: 'dev',
          beforeReplace: closeHost,
          live: { uiDirectory, logFile: live?.logFile ?? '' },
        },
        deps,
      );
    const bundle = await build();
    const rows = [{ label: 'VST3', value: bundle }];
    const session = ctx.devtools?.descriptorPath;
    const openHost = async (): Promise<void> => {
      if (host !== undefined || ctx.signal.aborted) return;
      try {
        if (target === 'linux-x64' && !process.env['DISPLAY'])
          throw new Error('Set DISPLAY to an X11 or XWayland display.');
        let executable: string;
        try {
          executable = resolveHost().executable;
        } catch (error) {
          if (
            (error as { code?: string } | null)?.code !== 'executable-not-found'
          )
            throw error;
          executable = (
            await prepareHost({ log: (line) => ctx.logger.info(line) })
          ).executable;
        }
        ctx.signal.throwIfAborted();
        const current = await launchHost({
          executable,
          plugin: bundle,
          editor: true,
          presentation: null,
          detached: true,
          env: { SOUNDOR_DEVTOOLS_SESSION: session },
          signal: ctx.signal,
          onLog: (line) => {
            if (!line.startsWith('[soundor] ')) ctx.logger.info(line);
          },
        });
        host = current;
        reopen = true;
        current.once('editorClosed', () => {
          if (host !== current) return;
          reopen = false;
          void enqueue(async () => {
            if (host !== current) return;
            await closeHost();
            ctx.logger.info('VST3 host closed. Press v + enter to reopen it.');
          });
        });
        void current.exited.then(() => {
          if (host !== current) return;
          host = undefined;
          reopen = false;
          if (!ctx.signal.aborted)
            ctx.logger.warn('VST3 host exited. Press v + enter to reopen it.');
        });
        ctx.logger.info(`Opened the VST3 in the host: ${bundle}`);
      } catch (error) {
        reopen = false;
        if (!ctx.signal.aborted)
          ctx.logger.warn(
            `The VST3 host could not open the plugin. Press v + enter to try again.\n${error instanceof Error ? error.message : String(error)}`,
          );
      }
    };
    ctx.session?.shortcut({
      key: 'v',
      description: 'open the VST3 in the host',
      action: () => enqueue(openHost),
    });
    const opening = enqueue(openHost);
    stopWatching = ctx.lib?.onChange?.(() => {
      void enqueue(async () => {
        ctx.logger.info('The Rust library changed; rebuilding the plugin');
        try {
          await build();
          if (reopen) await openHost();
          ctx.logger.info('Rebuilt the plugin with the changed Rust library.');
          ctx.session?.ready(rows);
        } catch (error) {
          if (!ctx.signal.aborted)
            ctx.logger.error(
              `The plugin could not be rebuilt; fix the error and save again.\n${error instanceof Error ? error.message : String(error)}`,
            );
        }
      });
    });
    await opening;
    ctx.logger.info(`Debug VST3 ready in ${bundle}.`);
    if (session !== undefined)
      ctx.logger.info(
        `DevTools in an external host: start it with SOUNDOR_DEVTOOLS_SESSION=${shellQuote(session)} in its environment.`,
      );
    ctx.session?.ready(rows);
    await waitForAbort(ctx.signal);
  } finally {
    stopWatching?.();
    watcher?.close();
    await pending;
    await closeHost();
  }
}

/** `doctor`: the platform, Rust, a linker (and on Linux the C++ runtime and libcurl), the prebuilt adapter. */
export async function vst3Doctor(
  _config: ResolvedSoundorConfig,
  _ctx: Ctx,
  deps: Vst3PhaseDeps = {},
): Promise<DoctorReport> {
  const probe = deps.probe ?? probeCommand;
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const checks: DoctorReport['checks'] = [];
  const target = hostTarget(platform, arch);
  checks.push(
    target !== undefined
      ? {
          label: 'Platform',
          status: 'ok',
          detail: `${platform} ${arch}: ${target}`,
        }
      : {
          label: 'Platform',
          status: 'fail',
          detail: `${platform} ${arch}: the VST3 runtime builds on Linux x86_64, macOS and Windows x64`,
          suggestion:
            'Build the plugin on Linux x86_64, macOS or Windows x64; the web runtime runs anywhere.',
        },
  );
  for (const [label, cmd, suggestion] of [
    ['Cargo', 'cargo', 'Install Rust: https://rustup.rs'],
    ['rustc', 'rustc', 'Install Rust: https://rustup.rs'],
  ] as const) {
    const result = probe(cmd, ['--version']);
    checks.push(
      result.ok
        ? { label, status: 'ok', detail: result.version ?? '' }
        : { label, status: 'fail', detail: result.error, suggestion },
    );
  }
  if (target === 'windows-x64') {
    try {
      const msvc = (deps.msvc ?? findMsvcLinker)();
      checks.push({
        label: 'Linker (MSVC link.exe)',
        status: 'ok',
        detail: `${msvc.linker} (${msvc.source})`,
      });
    } catch (error) {
      checks.push({
        label: 'Linker (MSVC link.exe)',
        status: 'fail',
        detail: error instanceof Error ? error.message : String(error),
        suggestion:
          'Install Visual Studio 2022 or later, or its Build Tools, with "Desktop development with C++".',
      });
    }
  } else if (target !== undefined) {
    const driver = compilerDriver();
    const cc = probe(driver, ['--version']);
    checks.push(
      cc.ok
        ? {
            label: 'Linker (C++ compiler driver)',
            status: 'ok',
            detail: `${driver}: ${(cc.version ?? '').split('\n')[0]}`,
          }
        : {
            label: 'Linker (C++ compiler driver)',
            status: 'fail',
            detail: `${driver}: ${cc.error}`,
            suggestion:
              target === 'macos-universal'
                ? "Install Apple's Command Line Tools (xcode-select --install): they link the plugin, and Rust needs them too."
                : 'Install g++ or clang++ (Debian, Ubuntu: sudo apt install build-essential; Fedora: sudo dnf install gcc-c++): it links the plugin, and Rust needs a C compiler to link on Linux too.',
          },
    );
    if (cc.ok && target === 'linux-x64') {
      const libstdcxx = probe(driver, ['-print-file-name=libstdc++.a']);
      const found = libstdcxx.ok && (libstdcxx.version ?? '').startsWith('/');
      checks.push(
        found
          ? {
              label: 'Static C++ runtime',
              status: 'ok',
              detail: libstdcxx.version ?? '',
            }
          : {
              label: 'Static C++ runtime',
              status: 'fail',
              detail:
                'libstdc++.a was not found: plugins carry their C++ runtime',
              suggestion:
                'Fedora, RHEL: sudo dnf install libstdc++-static. Debian, Ubuntu: it comes with g++.',
            },
      );
    }
  }
  const exists = deps.exists ?? existsSync;
  if (target === 'linux-x64') {
    const curl = ['libcurl.so.4', 'libcurl-gnutls.so.4']
      .flatMap((name) => LIBRARY_DIRECTORIES.map((dir) => join(dir, name)))
      .find((path) => exists(path));
    checks.push(
      curl !== undefined
        ? { label: 'libcurl (fetch)', status: 'ok', detail: curl }
        : {
            label: 'libcurl (fetch)',
            status: 'warn',
            detail:
              "no libcurl.so.4: plugins' fetch() fails on this machine (the system's libcurl is their HTTP stack)",
            suggestion:
              'Debian, Ubuntu: sudo apt install libcurl4t64 (before 24.04: libcurl4). Fedora: sudo dnf install libcurl.',
          },
    );
  }
  if (target !== undefined) {
    let manifest: ReturnType<typeof adapterManifest>;
    try {
      manifest = adapterManifest(PACKAGE_ROOT);
    } catch (error) {
      checks.push({
        label: 'Prebuilt adapters',
        status: 'fail',
        detail: error instanceof Error ? error.message : String(error),
        suggestion: 'Reinstall @soundor/vst3-runtime.',
      });
      return { checks };
    }
    for (const variant of ['release', 'debug'] as const) {
      const label = `Prebuilt adapter (${variant})`;
      if (manifest !== undefined) {
        const artifact = manifest.value.artifacts.find(
          (entry) => entry.target === target && entry.variant === variant,
        );
        checks.push(
          artifact !== undefined
            ? {
                label,
                status: 'ok',
                detail: `${artifact.file} of ${manifest.value.tag} (downloaded into the Soundor cache on first use)`,
              }
            : {
                label,
                status: 'fail',
                detail: `${manifest.value.tag} has no ${variant} adapter for ${target}`,
                suggestion: 'Reinstall @soundor/vst3-runtime.',
              },
        );
        continue;
      }
      const archive = join(
        adapterDirectory(PACKAGE_ROOT, target, variant),
        'lib',
        adapterArchiveName(target),
      );
      checks.push(
        exists(archive)
          ? { label, status: 'ok', detail: archive }
          : {
              label,
              status: 'fail',
              detail: `${archive} is missing`,
              suggestion: 'pnpm --filter @soundor/vst3-runtime build:native',
            },
      );
    }
  }
  return { checks };
}

export const vst3Runtime = defineRuntime<Vst3Options>({
  id: RUNTIME_ID,
  // What the engine's DevTools bridge offers, in Debug builds.
  capabilities: {
    devtools: {
      inspector: true,
      accessibility: true,
      animations: true,
      performance: true,
      input: true,
      capture: true,
    },
  },
  gen: vst3Gen,
  dev: (config, ctx) => vst3Dev(config, ctx),
  build: (config, ctx) => vst3Build(config, ctx),
  doctor: (config, ctx) => vst3Doctor(config, ctx),
});

export { vst3Build, vst3Dev, vst3Gen };
