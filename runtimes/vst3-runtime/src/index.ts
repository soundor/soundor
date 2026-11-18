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
}

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

/** `build`: the release bundle under `.soundor/dist/vst3`, or with --debug a Debug one, for tests. */
async function vst3Build(
  config: ResolvedSoundorConfig,
  ctx: Ctx,
  deps: Vst3PhaseDeps = {},
): Promise<void> {
  const debug = ctx.mode === 'debug';
  const bundle = await buildPlugin(
    config,
    ctx,
    {
      variant: debug ? 'debug' : 'release',
      out: ctx.paths.dist,
      label: debug ? 'debug-build' : 'release',
    },
    deps,
  );
  ctx.logger.info(
    debug
      ? `Debug VST3 in ${bundle}: for tests, not for release`
      : `VST3 in ${bundle}. Copy or link it into ~/.vst3 for hosts to find it.`,
  );
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/** `dev`: a Debug build whose UI reloads from the CLI's live bundle, rebuilt when lib/ changes. */
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
  if (live === undefined && ctx.ui !== undefined)
    await writeNativeUi(ctx.ui, uiDirectory, 'development');
  let stopWatching: (() => void) | undefined;
  try {
    await watcher?.ready;
    const build = (): Promise<string> =>
      buildPlugin(
        config,
        ctx,
        {
          variant: 'debug',
          out: join(ctx.paths.cache, 'dev', 'bundle'),
          label: 'dev',
          live: { uiDirectory, logFile: live?.logFile ?? '' },
        },
        deps,
      );
    const bundle = await build();
    const rows = [{ label: 'VST3', value: bundle }];
    let rebuilding = Promise.resolve();
    stopWatching = ctx.lib?.onChange?.(() => {
      rebuilding = rebuilding.then(async () => {
        ctx.logger.info('The Rust library changed; rebuilding the plugin');
        try {
          await build();
          ctx.logger.info(
            'Rebuilt the plugin; open it again in the host to load it.',
          );
          ctx.session?.ready(rows);
        } catch (error) {
          if (!ctx.signal.aborted)
            ctx.logger.error(
              `The plugin could not be rebuilt; fix the error and save again.\n${error instanceof Error ? error.message : String(error)}`,
            );
        }
      });
    });
    ctx.logger.info(
      `Debug VST3 ready in ${bundle}. Open it in a VST3 host (link it into ~/.vst3); its UI reloads on every change and its console appears here.`,
    );
    ctx.session?.ready(rows);
    await waitForAbort(ctx.signal);
  } finally {
    stopWatching?.();
    watcher?.close();
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
  gen: vst3Gen,
  dev: (config, ctx) => vst3Dev(config, ctx),
  build: (config, ctx) => vst3Build(config, ctx),
  doctor: (config, ctx) => vst3Doctor(config, ctx),
});

export { vst3Build, vst3Dev, vst3Gen };
