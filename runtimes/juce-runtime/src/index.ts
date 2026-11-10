/**
 * `@soundor/juce-runtime` — the official reference Soundor runtime.
 *
 * Builds the plugin with JUCE, binds DSP parameters through an
 * `AudioProcessorValueTreeState`, generates the `soundor:native` bindings, and
 * owns the build/packaging and dev workflows for VST3/AU.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, type Dirent } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  defineRuntime,
  EnvError,
  probeCommand,
  runCommand,
  type CommandProbe,
  type CommandRunner,
  type DevSummaryRow,
  type DoctorReport,
  type LifecycleContext,
  type Logger,
  type MacosSigning,
  type SoundorConfig,
} from '@soundor/runtime-sdk';

import { generateJuceSources } from './codegen';
import {
  chooseDevLaunch,
  DevVst3Host,
  findVst3Host,
  HOST_PACKAGE,
  loadHostModule,
  prepareHostExecutable,
  type HostModule,
  type Vst3HostAvailability,
} from './dev-host';
import { buildDoctorReport, findCMake, findCppCompiler } from './doctor';
import {
  glibcRequirement,
  isNewerThanBaseline,
  LINUX_GLIBC_BASELINE,
} from './elf-glibc';
import { nativeUiDir, watchNativeUi, writeNativeUi } from './native-ui';
import {
  resolveJuceOptions,
  type JuceFormat,
  type JuceOptions,
  type WindowsCrt,
} from './options';
import { resolveJuce } from './resolve-juce';
import { juceScaffoldFiles } from './scaffold';

export type {
  DevLaunch,
  JuceFormat,
  JuceOptions,
  ResolvedJuceOptions,
  WindowsCrt,
} from './options';
export { generateNativeModuleSources } from './native-codegen';
export { generateJuceSources } from './codegen';
export { resolveJuce } from './resolve-juce';
export { buildDoctorReport } from './doctor';

/** The runtime id; must match `config.runtimes[].id`. */
export const RUNTIME_ID = 'juce';

/**
 * The native runtime sources shipped with this package (`native/`), which the
 * generated setup.cmake builds into the plugin. Resolves from both `dist/` and
 * `src/`.
 */
export const NATIVE_DIR = fileURLToPath(new URL('../native', import.meta.url));

/** Injectable toolchain dependencies (defaulted; overridden in tests). */
export interface JucePhaseDeps {
  readonly run?: CommandRunner;
  readonly probe?: CommandProbe;
  readonly launchStandalone?: StandaloneLauncher;
  /** `@soundor/vst3-host` as the project has it; undefined when it has not. */
  readonly loadHost?: (root: string) => Promise<HostModule | undefined>;
  readonly platform?: NodeJS.Platform;
}

type Ctx = LifecycleContext<JuceOptions>;

const FORMAT_NAMES: Record<JuceFormat, string> = {
  vst3: 'VST3',
  au: 'AU',
  standalone: 'Standalone',
};
type StandaloneLauncher = (
  target: string,
  platform: NodeJS.Platform,
  logger: Logger,
  descriptorPath?: string,
) => boolean;

/**
 * `init` — scaffold the user-owned host under `runtimes/<id>/` (idempotent).
 * The scaffold inherits the generated framework and `include()`s its
 * `setup.cmake`; it is written once and never overwritten.
 */
export async function juceInit(config: SoundorConfig, ctx: Ctx): Promise<void> {
  const options = resolveJuceOptions(ctx.options, config.plugin);
  const scaffoldDir = ctx.fs.resolve('runtimes', RUNTIME_ID);
  // CMake wants a forward-slash path regardless of platform.
  const includePath = relative(scaffoldDir, join(ctx.paths.gen, 'setup.cmake'))
    .split(sep)
    .join('/');
  const files = juceScaffoldFiles(options, RUNTIME_ID, includePath);

  for (const file of files) {
    const target = ctx.fs.resolve(file.path);
    if (await ctx.fs.exists(target)) {
      ctx.logger.info(`skip ${file.path} (exists)`);
      continue;
    }
    await ctx.fs.write(target, file.contents);
    ctx.logger.info(`create ${file.path}`);
  }
}

/**
 * `gen` — emit the ephemeral framework (setup.cmake + `soundor::` base classes)
 * into `.soundor/generated/runtimes/<id>/`. Resolves JUCE best-effort so
 * `setup.cmake` can bake the path; `gen` never requires JUCE to be present.
 */
export async function juceGen(config: SoundorConfig, ctx: Ctx): Promise<void> {
  const options = resolveJuceOptions(ctx.options, config.plugin);
  const resolution = await resolveJuce(ctx.fs, options);
  ctx.codegen.emitAll(
    generateJuceSources(config, {
      options,
      jucePath: resolution.path,
      nativeDir: NATIVE_DIR,
    }),
  );
}

/** `dev` — debug build, then what `chooseDevLaunch` says opens it. */
export async function juceDev(
  config: SoundorConfig,
  ctx: Ctx,
  deps: JucePhaseDeps = {},
): Promise<void> {
  const run = deps.run ?? runCommand;
  const platform = deps.platform ?? process.platform;
  const options = resolveJuceOptions(ctx.options, config.plugin);
  const jucePath = await requireJuce(ctx, options);
  requireToolchain(deps.probe ?? probeCommand);
  // Before the build, which can take minutes: a host that cannot run says so.
  const hostAvailability: Vst3HostAvailability = options.formats.includes(
    'vst3',
  )
    ? await findVst3Host(ctx.fs.resolve('.'), deps.loadHost ?? loadHostModule)
    : { status: 'absent' };
  let devLaunch = chooseDevLaunch(options, hostAvailability);
  if (hostAvailability.status === 'unsupported')
    ctx.logger.warn(hostAvailability.reason);
  else if (
    hostAvailability.status === 'absent' &&
    options.formats.includes('vst3') &&
    options.devLaunch === undefined
  )
    ctx.logger.info(
      `Add ${HOST_PACKAGE} to the project's devDependencies to run the VST3 here.`,
    );
  if (devLaunch === 'vst3' && hostAvailability.status === 'available') {
    try {
      await prepareHostExecutable(hostAvailability.module, (message) =>
        ctx.logger.info(message),
      );
    } catch (error) {
      // Asked for by name, it fails. Otherwise the plugin can still be developed.
      if (options.devLaunch === 'vst3') throw error;
      devLaunch = options.formats.includes('standalone') ? 'standalone' : false;
      ctx.logger.warn(
        `The VST3 host cannot run, so it stays closed; v tries again.\n${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const projectDir = ctx.fs.resolve('runtimes', RUNTIME_ID);
  const buildDir = join(ctx.paths.cache, 'build-debug');
  let devHost: DevVst3Host | undefined;
  const ui = ctx.ui;
  const live = ui?.live;
  // The UI in the engine's form: reloaded from disk on every build when live
  // (soundor dev), embedded otherwise.
  const uiDir = nativeUiDir(ctx.paths.cache, 'debug');
  const watcher =
    live === undefined
      ? undefined
      : watchNativeUi({ ...ui!, live }, uiDir, (error) =>
          ctx.logger.error(
            `The UI could not be prepared for the plugin; it keeps the last good one.\n${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
  if (live === undefined && ui !== undefined)
    await writeNativeUi(ui, uiDir, 'development');
  try {
    await watcher?.ready;
    await prepareBuildDir(buildDir, platform, jucePath, ctx.logger);

    const configureArgs = [
      '-S',
      projectDir,
      '-B',
      buildDir,
      ...generatorArgs(platform),
      '-DCMAKE_BUILD_TYPE=Debug',
      `-DSOUNDOR_ENGINE_MODE=${options.engineMode}`,
      `-DSOUNDOR_ENABLE_DEVTOOLS=${ctx.devtools === undefined ? 'OFF' : 'ON'}`,
      `-DJUCE_DIR=${jucePath}`,
      // The Node running the CLI lowers the runtime's own modules.
      `-DSOUNDOR_NODE_EXE=${process.execPath}`,
      // Always set, so a UI removed since the last configure is not kept cached.
      // A live UI (soundor dev) is loaded from disk and reloaded, not embedded.
      `-DSOUNDOR_UI_DIR=${live === undefined && ui !== undefined ? uiDir : ''}`,
      `-DSOUNDOR_UI_DEV_DIR=${live === undefined ? '' : uiDir}`,
      `-DSOUNDOR_UI_DEV_LOG=${live?.logFile ?? ''}`,
      // Debug builds are signed ad-hoc: no timestamp server, and a debugger can
      // attach without the hardened runtime in the way.
      ...signingArgs(platform, { identity: '-', source: 'default' }),
      ...deploymentTargetArgs(platform, options.macosDeploymentTarget),
      ...crtArgs(platform, options.windowsCrt, true),
    ];

    ctx.logger.info('Configuring debug build');
    await run({
      cmd: 'cmake',
      args: configureArgs,
      cwd: projectDir,
      logger: ctx.logger,
      signal: ctx.signal,
    });
    await run({
      cmd: 'cmake',
      args: ['--build', buildDir, '--config', 'Debug', '--parallel'],
      cwd: projectDir,
      logger: ctx.logger,
      signal: ctx.signal,
    });

    const rows: DevSummaryRow[] = [
      {
        label: 'Formats',
        value: options.formats.map((format) => FORMAT_NAMES[format]).join(', '),
      },
    ];
    const artefacts = await findArtefactsDir(buildDir);
    if (artefacts !== undefined)
      rows.push({ label: 'Plugins', value: artefacts });
    if (hostAvailability.status === 'available') {
      const plugin =
        artefacts === undefined ? undefined : await findVst3Bundle(artefacts);
      if (plugin === undefined) {
        ctx.logger.warn(
          `VST3 build finished, but no bundle was found under ${buildDir}`,
        );
      } else {
        devHost = new DevVst3Host({
          module: hostAvailability.module,
          plugin,
          stateFile: join(ctx.paths.state, 'vst3.json'),
          logger: ctx.logger,
          signal: ctx.signal,
          environment: () =>
            hostEnvironment(
              plugin,
              platform,
              ctx.logger,
              ctx.devtools?.descriptorPath,
            ),
        });
        const host = devHost;
        rows.push({ label: 'VST3', value: plugin });
        ctx.session?.shortcut({
          key: 'v',
          description: 'launch the VST3 in the host',
          action: () => host.launch(),
        });
      }
    }
    if (options.formats.includes('standalone')) {
      const target = await findStandaloneTarget(buildDir, platform);
      if (target === undefined) {
        ctx.logger.warn(
          `Standalone build finished, but no app was found under ${buildDir}`,
        );
      } else {
        const launch = (): void =>
          launchStandaloneBuild(
            target,
            ctx,
            deps.launchStandalone ?? launchStandalone,
            platform,
          );
        if (devLaunch === 'standalone') launch();
        rows.push({ label: 'Standalone', value: target });
        ctx.session?.shortcut({
          key: 's',
          description: 'launch the Standalone',
          action: async () => launch(),
        });
      }
    }
    if (devLaunch === 'vst3') await devHost?.launch();

    ctx.logger.info(
      live === undefined
        ? 'Debug build ready.'
        : 'Debug build ready. The plugin UI reloads on every change; its console appears here.',
    );
    ctx.session?.ready(rows);
    await waitForAbort(ctx.signal);
  } finally {
    await devHost?.close();
    watcher?.close();
  }
}

/**
 * `build` — under `ctx.paths.dist`: the production package, or with mode `debug`
 * a Debug build with DevTools and the UI embedded, for tests. It has build and
 * UI directories of its own, so it never disturbs a running `soundor dev`.
 */
export async function juceBuild(
  config: SoundorConfig,
  ctx: Ctx,
  deps: JucePhaseDeps = {},
): Promise<void> {
  const run = deps.run ?? runCommand;
  const platform = deps.platform ?? process.platform;
  const debug = ctx.mode === 'debug';
  const configuration = debug ? 'Debug' : 'Release';
  const options = resolveJuceOptions(ctx.options, config.plugin);
  const jucePath = await requireJuce(ctx, options);
  requireToolchain(deps.probe ?? probeCommand);
  const projectDir = ctx.fs.resolve('runtimes', RUNTIME_ID);
  const buildDir = join(
    ctx.paths.cache,
    debug ? 'build-debug-build' : 'build-release',
  );
  const uiDir = nativeUiDir(ctx.paths.cache, debug ? 'debug-build' : 'release');
  if (ctx.ui !== undefined) {
    // Development output is kept between builds, for a live UI; this one is not.
    if (debug) await rm(uiDir, { recursive: true, force: true });
    await writeNativeUi(ctx.ui, uiDir, debug ? 'development' : 'production');
  }
  await prepareBuildDir(buildDir, platform, jucePath, ctx.logger);

  const signing = debug
    ? ({ identity: '-', source: 'default' } as const)
    : ctx.signing.macos;
  const configureArgs = [
    '-S',
    projectDir,
    '-B',
    buildDir,
    ...generatorArgs(platform),
    `-DCMAKE_BUILD_TYPE=${configuration}`,
    `-DSOUNDOR_ENGINE_MODE=${options.engineMode}`,
    `-DSOUNDOR_ENABLE_DEVTOOLS=${debug ? 'ON' : 'OFF'}`,
    '-DSOUNDOR_UI_DEV_DIR=',
    '-DSOUNDOR_UI_DEV_LOG=',
    `-DJUCE_DIR=${jucePath}`,
    `-DSOUNDOR_NODE_EXE=${process.execPath}`,
    `-DSOUNDOR_UI_DIR=${ctx.ui === undefined ? '' : uiDir}`,
    ...signingArgs(platform, signing),
    ...deploymentTargetArgs(platform, options.macosDeploymentTarget),
    ...crtArgs(platform, options.windowsCrt, debug),
  ];
  if (ctx.ui === undefined) {
    ctx.logger.warn(
      'The project has no UI entry (src/main.ts[x]); the plugin view will be empty.',
    );
  }
  if (platform === 'darwin' && !debug) {
    ctx.logger.info(
      ctx.signing.macos.identity === '-'
        ? 'Signing ad-hoc (set SOUNDOR_MACOS_SIGNING_IDENTITY to distribute the plugin)'
        : `Signing with '${ctx.signing.macos.identity}'`,
    );
  }
  ctx.logger.info(`Configuring ${debug ? 'debug' : 'release'} build`);
  await run({
    cmd: 'cmake',
    args: configureArgs,
    cwd: projectDir,
    logger: ctx.logger,
    signal: ctx.signal,
  });
  await run({
    cmd: 'cmake',
    args: ['--build', buildDir, '--config', configuration, '--parallel'],
    cwd: projectDir,
    logger: ctx.logger,
    signal: ctx.signal,
  });

  if (debug) {
    const formats = await collectDebugFormats(buildDir, ctx.paths.dist);
    ctx.logger.info(
      formats.length > 0
        ? `Debug build in ${ctx.paths.dist} (${formats.join(', ')}): for tests, not for release; it has DevTools`
        : `Build finished; no debug formats found under ${buildDir}`,
    );
    return;
  }
  const collected = await collectArtifacts(buildDir, ctx.paths.dist);
  ctx.logger.info(
    collected > 0
      ? `Packaged ${collected} artifact folder(s) into ${ctx.paths.dist}`
      : `Build finished; no *_artefacts found under ${buildDir}`,
  );
  if (platform === 'linux' && collected > 0) await reportGlibc(ctx);
}

/** A release loads only where glibc is at least what it was built against. */
async function reportGlibc(ctx: Ctx): Promise<void> {
  const entries = await readdir(ctx.paths.dist, {
    recursive: true,
    withFileTypes: true,
  });
  const version = await glibcRequirement(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.so'))
      .map((entry) => join(entry.parentPath, entry.name)),
  );
  if (version === undefined) return;
  if (isNewerThanBaseline(version))
    ctx.logger.warn(
      `This release needs glibc ${version}, so it won't load on Ubuntu 24.04 (glibc ${LINUX_GLIBC_BASELINE}) or other older systems. Build releases on Ubuntu 24.04.`,
    );
  else ctx.logger.info(`This release needs glibc ${version} or newer.`);
}

/** `doctor` — verify CMake, a compiler, and a locatable JUCE checkout. */
export async function juceDoctor(
  config: SoundorConfig,
  ctx: Ctx,
): Promise<DoctorReport> {
  const options = resolveJuceOptions(ctx.options, config.plugin);
  return buildDoctorReport(ctx.fs, {
    jucePath: options.jucePath,
    engine: { mode: options.engineMode },
    formats: options.formats,
    windows: { crt: options.windowsCrt },
  });
}

/** The factory a config author registers: `runtimes: [juceRuntime({ ... })]`. */
export const juceRuntime = defineRuntime<JuceOptions>({
  id: RUNTIME_ID,
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
  init: juceInit,
  gen: juceGen,
  dev: (config, ctx) => juceDev(config, ctx),
  build: (config, ctx) => juceBuild(config, ctx),
  doctor: juceDoctor,
});

export default juceRuntime;

/** Resolves JUCE or throws an {@link EnvError} the CLI surfaces as an ENV failure. */
async function requireJuce(
  ctx: Ctx,
  options: ReturnType<typeof resolveJuceOptions>,
): Promise<string> {
  const resolution = await resolveJuce(ctx.fs, options);
  if (!resolution.found || resolution.path === undefined) {
    throw new EnvError(
      'JUCE not found. Set jucePath in juceRuntime({ jucePath }), set JUCE_DIR, or install JUCE in a well-known location. Run `soundor doctor` for details.',
    );
  }
  return resolution.path;
}

function requireToolchain(probe: CommandProbe): void {
  if (!findCMake(probe)) {
    throw new EnvError(
      'CMake not found. Install CMake >= 3.22 and ensure `cmake` is in PATH. Run `soundor doctor` for details.',
    );
  }
  if (!probe('ninja', ['--version']).ok) {
    throw new EnvError(
      'Ninja not found. Soundor builds Skia with it, and the plugin too on macOS and Linux; install it and ensure `ninja` is in PATH. Run `soundor doctor` for details.',
    );
  }
  if (!findCppCompiler(probe)) {
    throw new EnvError(
      'No C++ compiler found. Install a C++ toolchain (Xcode Command Line Tools, MSVC Build Tools, or GCC/Clang) and ensure `c++`, `clang++`, or `g++` is in PATH. Run `soundor doctor` for details.',
    );
  }
}

/**
 * The CMake generator: Ninja on macOS and Linux; on Windows CMake's default,
 * Visual Studio, which finds MSVC without a developer environment.
 */
function generatorArgs(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? [] : ['-G', 'Ninja'];
}

/**
 * The oldest macOS to build for: on the command line, as CMake wants it before
 * the first `project()`, which the project's own CMakeLists.txt calls.
 */
function deploymentTargetArgs(
  platform: NodeJS.Platform,
  deploymentTarget: string,
): string[] {
  return platform === 'darwin'
    ? [`-DCMAKE_OSX_DEPLOYMENT_TARGET=${deploymentTarget}`]
    : [];
}

/**
 * The C runtime a Windows build links, on the command line for the same reason.
 * One value, as each build directory builds one configuration.
 */
function crtArgs(
  platform: NodeJS.Platform,
  crt: WindowsCrt,
  debug: boolean,
): string[] {
  if (platform !== 'win32') return [];
  const library = `MultiThreaded${debug ? 'Debug' : ''}${crt === 'MD' ? 'DLL' : ''}`;
  return [`-DCMAKE_MSVC_RUNTIME_LIBRARY=${library}`];
}

/** CMake cache variables `soundor_finalize_plugin` signs macOS bundles with. */
function signingArgs(
  platform: NodeJS.Platform,
  signing: MacosSigning,
): string[] {
  if (platform !== 'darwin') return [];
  return [
    `-DSOUNDOR_MACOS_SIGNING_IDENTITY=${signing.identity}`,
    `-DSOUNDOR_MACOS_KEYCHAIN=${signing.keychain ?? ''}`,
  ];
}

/**
 * Creates `buildDir`, first deleting a tree CMake cannot reconfigure: one
 * configured with another JUCE checkout (JUCE's juceaide sub-build refuses a
 * new source directory), or, on macOS and Linux, with a generator other than
 * Ninja (as builds before Soundor chose one were).
 */
async function prepareBuildDir(
  buildDir: string,
  platform: NodeJS.Platform,
  jucePath: string,
  logger: Logger,
): Promise<void> {
  let cache: string | undefined;
  try {
    cache = await readFile(join(buildDir, 'CMakeCache.txt'), 'utf8');
  } catch {
    cache = undefined;
  }
  const cached = (name: string): string | undefined =>
    cache?.match(new RegExp(`^${name}:[A-Z]+=(.*)$`, 'm'))?.[1]?.trim();
  const generator = cached('CMAKE_GENERATOR');
  const juce = cached('JUCE_DIR');
  let reason: string | undefined;
  if (juce !== undefined && !samePath(juce, jucePath, platform)) {
    reason = `it was configured with JUCE at ${juce}, and JUCE is now at ${jucePath}`;
  } else if (
    platform !== 'win32' &&
    generator !== undefined &&
    generator !== 'Ninja'
  ) {
    reason = `it was configured for ${generator}, and Soundor builds with Ninja`;
  }
  if (reason !== undefined) {
    logger.info(`Recreating ${buildDir}: ${reason}`);
    await rm(buildDir, { recursive: true, force: true });
  }
  await mkdir(buildDir, { recursive: true });
}

/** Whether two absolute paths name the same directory, as CMake caches them. */
function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const normalize = (path: string): string => {
    const forward = path.replaceAll('\\', '/').replace(/\/+$/, '');
    return platform === 'win32' ? forward.toLowerCase() : forward;
  };
  return normalize(a) === normalize(b);
}

/** Copies every JUCE `*_artefacts` folder from the build tree into `distDir`. */
async function collectArtifacts(
  buildDir: string,
  distDir: string,
): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(buildDir);
  } catch {
    return 0;
  }
  const artefacts = entries.filter((name) => name.endsWith('_artefacts'));
  if (artefacts.length === 0) return 0;
  await mkdir(distDir, { recursive: true });
  for (const name of artefacts) {
    await cp(join(buildDir, name), join(distDir, name), { recursive: true });
  }
  return artefacts.length;
}

/**
 * Copies each format's output from the build tree to `<distDir>/<format>/`,
 * replacing what the build makes and nothing else: the folder is the user's.
 */
async function collectDebugFormats(
  buildDir: string,
  distDir: string,
): Promise<string[]> {
  const artefacts = await findArtefactsDir(buildDir);
  if (artefacts === undefined) return [];
  const formats = (await readdir(artefacts, { withFileTypes: true })).filter(
    // Beside them is the shared code's static library.
    (entry) => entry.isDirectory(),
  );
  for (const { name: format } of formats) {
    for (const output of await readdir(join(artefacts, format))) {
      const target = join(distDir, format, output);
      await rm(target, { recursive: true, force: true });
      // Symbolic links stay as they are: a signed bundle has them.
      await cp(join(artefacts, format, output), target, {
        recursive: true,
        verbatimSymlinks: true,
      });
    }
  }
  return formats.map(({ name }) => name);
}

function launchStandaloneBuild(
  target: string,
  ctx: Ctx,
  launch: StandaloneLauncher,
  platform: NodeJS.Platform,
): void {
  const launched =
    ctx.devtools?.descriptorPath === undefined
      ? launch(target, platform, ctx.logger)
      : launch(target, platform, ctx.logger, ctx.devtools.descriptorPath);
  if (launched) {
    ctx.logger.info(`Launching standalone app: ${target}`);
  }
}

async function findVst3Bundle(artefacts: string): Promise<string | undefined> {
  const dir = join(artefacts, 'VST3');
  if (!existsSync(dir)) return undefined;
  const bundle = (await readdir(dir)).find((name) => name.endsWith('.vst3'));
  return bundle === undefined ? undefined : join(dir, bundle);
}

/**
 * What the VST3 host runs with, or undefined (and how to run it by hand) where
 * it could not open a window.
 */
function hostEnvironment(
  plugin: string,
  platform: NodeJS.Platform,
  logger: Logger,
  descriptorPath?: string,
): Record<string, string | undefined> | undefined {
  const session =
    descriptorPath === undefined
      ? {}
      : { SOUNDOR_DEVTOOLS_SESSION: descriptorPath };
  if (platform === 'darwin' || platform === 'win32') return session;
  const env = linuxDesktopEnv();
  if (!canLaunchLinuxGui(env)) {
    logger.warn(
      'Skipping the VST3 host: no reachable Linux GUI display was found.',
    );
    logger.warn(
      `Run manually: ${descriptorPath === undefined ? '' : `SOUNDOR_DEVTOOLS_SESSION=${shellQuote(descriptorPath)} `}npx soundor-vst3-host open ${shellQuote(plugin)}`,
    );
    return undefined;
  }
  return { ...env, ...session };
}

/** The directory JUCE puts the debug plugin formats in. */
async function findArtefactsDir(buildDir: string): Promise<string | undefined> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(buildDir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const entry = entries.find(
    (candidate) =>
      candidate.isDirectory() && candidate.name.endsWith('_artefacts'),
  );
  if (entry === undefined) return undefined;
  const dir = join(buildDir, entry.name);
  return existsSync(join(dir, 'Debug')) ? join(dir, 'Debug') : dir;
}

async function findStandaloneTarget(
  buildDir: string,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(buildDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith('_artefacts')) continue;
    for (const configuration of ['Debug', '']) {
      const target = await findLaunchableInDir(
        join(buildDir, entry.name, configuration, 'Standalone'),
        platform,
      );
      if (target !== undefined) return target;
    }
  }
  return undefined;
}

async function findLaunchableInDir(
  dir: string,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (
      platform === 'darwin' &&
      entry.isDirectory() &&
      entry.name.endsWith('.app')
    ) {
      return path;
    }
    if (platform === 'win32' && entry.isFile() && entry.name.endsWith('.exe')) {
      return path;
    }
    if (platform !== 'darwin' && platform !== 'win32' && entry.isFile()) {
      const info = await stat(path);
      if ((info.mode & 0o111) !== 0) return path;
    }
  }
  return undefined;
}

function launchStandalone(
  target: string,
  platform: NodeJS.Platform,
  logger: Logger,
  descriptorPath?: string,
): boolean {
  const debugEnv =
    descriptorPath === undefined
      ? {}
      : { SOUNDOR_DEVTOOLS_SESSION: descriptorPath };
  const child = (() => {
    if (platform === 'darwin') {
      if (descriptorPath !== undefined) {
        const directory = join(target, 'Contents', 'MacOS');
        const executable = readdirSync(directory, { withFileTypes: true }).find(
          (entry) => entry.isFile(),
        );
        if (executable === undefined) return undefined;
        return spawn(join(directory, executable.name), [], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, ...debugEnv },
        });
      }
      return spawn('open', [target], { detached: true, stdio: 'ignore' });
    }
    if (platform === 'win32') {
      return spawn(target, [], {
        cwd: dirname(target),
        detached: true,
        stdio: 'ignore',
        shell: true,
        env: { ...process.env, ...debugEnv },
      });
    }
    const env = { ...linuxDesktopEnv(), ...debugEnv };
    if (!canLaunchLinuxGui(env)) {
      logger.warn(
        'Skipping standalone auto-launch: no reachable Linux GUI display was found.',
      );
      logger.warn(
        `Run manually: ${descriptorPath === undefined ? '' : `SOUNDOR_DEVTOOLS_SESSION=${shellQuote(descriptorPath)} `}${shellQuote(target)}`,
      );
      return undefined;
    }
    return spawn('sh', ['-c', 'exec "$1"', 'soundor-standalone', target], {
      cwd: dirname(target),
      detached: true,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  })();
  if (child === undefined) return false;
  child.stderr?.on('data', (chunk: Buffer) => {
    logger.warn(chunk.toString('utf8').trimEnd());
  });
  child.on('error', (error) => {
    logger.warn(`Failed to launch standalone app: ${error.message}`);
  });
  child.on('close', (code, signal) => {
    if (code !== 0 || signal !== null) {
      logger.warn(
        signal === null
          ? `Standalone app exited with code ${code}`
          : `Standalone app exited after signal ${signal}`,
      );
    }
  });
  child.unref();
  return true;
}

function canLaunchLinuxGui(env: NodeJS.ProcessEnv): boolean {
  if (isContainer() && env['SOUNDOR_JUCE_LAUNCH_IN_CONTAINER'] !== '1') {
    return false;
  }

  const waylandDisplay = env['WAYLAND_DISPLAY'];
  const runtimeDir = env['XDG_RUNTIME_DIR'];
  if (waylandDisplay && runtimeDir) {
    if (existsSync(join(runtimeDir, waylandDisplay))) return true;
  }

  const display = env['DISPLAY'];
  if (!display) return false;
  const match = /^:(\d+)/.exec(display);
  if (match) return existsSync(`/tmp/.X11-unix/X${match[1]}`);

  // Remote X11 displays cannot be validated locally, but are valid launch envs.
  return true;
}

function isContainer(): boolean {
  return existsSync('/.dockerenv') || existsSync('/run/.containerenv');
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function linuxDesktopEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const result = spawnSync('systemctl', ['--user', 'show-environment'], {
    encoding: 'utf8',
  });
  if (result.status !== 0 || result.stdout.length === 0) return env;

  const keys = new Set([
    'DBUS_SESSION_BUS_ADDRESS',
    'DISPLAY',
    'GDK_BACKEND',
    'WAYLAND_DISPLAY',
    'XAUTHORITY',
    'XDG_CURRENT_DESKTOP',
    'XDG_RUNTIME_DIR',
    'XDG_SESSION_TYPE',
  ]);
  for (const line of result.stdout.split('\n')) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index);
    if (keys.has(key)) env[key] = line.slice(index + 1);
  }
  return env;
}

/** Resolves when `signal` aborts (keeps the long-lived `dev` phase alive). */
function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
