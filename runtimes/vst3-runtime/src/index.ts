/**
 * `@soundor/vst3-runtime`: Soundor plugins as Linux VST3 plugins, without
 * JUCE.
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

import { bundlePaths, writeBundleResources } from './bundle';
import { buildCrate, writeCrate } from './crate';
import { describePlugin, descriptorJson } from './descriptor';
import {
  compilerDriver,
  environmentLinkFlags,
  findAdapter,
  linkArguments,
  VERSION_SCRIPT,
} from './link';
import { resolveVst3Options, type Vst3Options } from './options';
import { embeddedFiles, watchNativeUi, writeNativeUi } from './ui';

export type { Vst3Options, ResolvedVst3Options } from './options';
export {
  classIds,
  describePlugin,
  descriptorJson,
  parameterVstId,
} from './descriptor';
export { linkArguments, VERSION_SCRIPT } from './link';
export { moduleInfo } from './bundle';

/** The runtime id: `soundor build vst3`. */
export const RUNTIME_ID = 'vst3';

/** This package's root (above dist/ or src/). */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

type Ctx = LifecycleContext<Vst3Options>;
type Variant = 'debug' | 'release';

/** Injectable for tests. */
export interface Vst3PhaseDeps {
  readonly run?: CommandRunner;
  readonly probe?: CommandProbe;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly engine?: (variant: Variant) => Promise<NativeEngineArtifact>;
  /** Whether a file exists (doctor's system library checks). */
  readonly exists?: (path: string) => boolean;
}

/** Where Linux distributions keep x86_64 libraries. */
const LIBRARY_DIRECTORIES = [
  '/usr/lib/x86_64-linux-gnu',
  '/lib/x86_64-linux-gnu',
  '/usr/lib64',
  '/lib64',
  '/usr/lib',
];

function requireLinux(deps: Vst3PhaseDeps): void {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  if (platform !== 'linux' || arch !== 'x64')
    throw new EnvError(
      `The VST3 runtime builds Linux x86_64 plugins, on Linux x86_64 (this is ${platform} ${arch}). Use the JUCE runtime elsewhere.`,
    );
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

/** The Hermes revision of an engine archive, which bytecode names. */
async function hermesRevision(artifact: NativeEngineArtifact): Promise<string> {
  const metadata = JSON.parse(
    await readFile(join(artifact.directory, 'soundor-engine.json'), 'utf8'),
  ) as {
    hermes?: { revision?: string };
  };
  const revision = metadata.hermes?.revision;
  if (revision === undefined)
    throw new EnvError(
      `${artifact.directory} does not name its Hermes revision.`,
    );
  return revision;
}

async function buildPlugin(
  config: ResolvedSoundorConfig,
  ctx: Ctx,
  build: BuildOptions,
  deps: Vst3PhaseDeps,
): Promise<string> {
  requireLinux(deps);
  if (ctx.lib === undefined)
    throw new EnvError(
      "The project has no Rust library (lib/Cargo.toml), which holds the plugin's processor and controller. Run `soundor gen` to create missing Rust starter files.",
    );
  const options = resolveVst3Options(ctx.options);
  const run = deps.run ?? runCommand;
  const cache = join(ctx.paths.cache, build.label);
  const artifact = await (
    deps.engine ??
    ((variant: Variant) => engine({ target: 'linux-x64', variant }))
  )(build.variant);
  ctx.logger.info(
    `Engine: ${artifact.version} ${build.variant} (${artifact.mode}: ${artifact.reason})`,
  );
  const adapter = await findAdapter(PACKAGE_ROOT, build.variant, artifact);

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
              revision: await hermesRevision(artifact),
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
    logger: ctx.logger,
    signal: ctx.signal,
  });

  await build.beforeReplace?.();
  ctx.signal.throwIfAborted();
  const paths = bundlePaths(build.out, config.plugin.name);
  await rm(paths.bundle, { recursive: true, force: true });
  await mkdir(paths.binaryDir, { recursive: true });
  const versionScript = join(cache, 'exports.map');
  await writeFile(versionScript, VERSION_SCRIPT);
  ctx.logger.info('Linking the plugin');
  await run({
    cmd: compilerDriver(),
    args: linkArguments({
      output: paths.binary,
      versionScript,
      adapter,
      rust,
      engineLibraries: artifact.libraries,
      engineFlags: artifact.linkFlags,
      release: build.variant === 'release',
      extra: environmentLinkFlags(),
    }),
    cwd: ctx.paths.root,
    logger: ctx.logger,
    signal: ctx.signal,
  });
  await writeBundleResources({
    paths,
    description,
    licenses: [
      {
        name: 'vst3sdk',
        directory: join(
          PACKAGE_ROOT,
          'prebuilt',
          `linux-x64-${build.variant}`,
          'licenses',
          'vst3sdk',
        ),
      },
      {
        name: 'soundor-engine',
        directory: join(artifact.directory, 'licenses'),
      },
    ],
  });
  return paths.bundle;
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
    `${debug ? 'Debug VST3 (with DevTools)' : 'VST3'} in ${bundle}. Copy or link it into ~/.vst3 for hosts to find it.`,
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
  requireLinux(deps);
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
        if (!process.env['DISPLAY'])
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

/** `doctor`: the platform, Rust, a linker, the C++ runtime, the prebuilt adapter. */
export async function vst3Doctor(
  _config: ResolvedSoundorConfig,
  _ctx: Ctx,
  deps: Vst3PhaseDeps = {},
): Promise<DoctorReport> {
  const probe = deps.probe ?? probeCommand;
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const checks: DoctorReport['checks'] = [];
  const linux = platform === 'linux' && arch === 'x64';
  checks.push({
    label: 'Platform',
    status: linux ? 'ok' : 'fail',
    detail: linux
      ? 'Linux x86_64'
      : `${platform} ${arch}: the VST3 runtime builds on Linux x86_64 only`,
    ...(linux
      ? {}
      : { suggestion: 'Build on Linux x86_64, or use the JUCE runtime here.' }),
  });
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
            'Install g++ or clang++ (Debian, Ubuntu: sudo apt install build-essential; Fedora: sudo dnf install gcc-c++): it links the plugin, and Rust needs a C compiler to link on Linux too.',
        },
  );
  if (cc.ok) {
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
  const exists = deps.exists ?? existsSync;
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
  for (const variant of ['release', 'debug'] as const) {
    const archive = join(
      PACKAGE_ROOT,
      'prebuilt',
      `linux-x64-${variant}`,
      'lib',
      'libsoundor_vst3.a',
    );
    checks.push(
      existsSync(archive)
        ? {
            label: `Prebuilt adapter (${variant})`,
            status: 'ok',
            detail: archive,
          }
        : {
            label: `Prebuilt adapter (${variant})`,
            status: 'fail',
            detail: `${archive} is missing`,
            suggestion:
              "In Soundor's workspace: pnpm --filter @soundor/vst3-runtime build:native. Installed: reinstall @soundor/vst3-runtime.",
          },
    );
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
