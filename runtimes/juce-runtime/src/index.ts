/**
 * `@soundor/juce-runtime` — the official reference Soundor runtime.
 *
 * Builds the plugin with JUCE, binds DSP parameters through an
 * `AudioProcessorValueTreeState`, generates the `soundor:native` bindings, and
 * owns the build/packaging and dev workflows for VST3/AU.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, type Dirent } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  defineRuntime,
  nativeAbiNamespace,
  EnvError,
  probeCommand,
  runCommand,
  type CommandProbe,
  type CommandRunner,
  type DoctorReport,
  type LifecycleContext,
  type Logger,
  type MacosSigning,
  type SoundorConfig,
} from '@soundor/runtime-sdk';

import { generateJuceSources } from './codegen';
import { buildDoctorReport, findCMake, findCppCompiler } from './doctor';
import { resolveJuceOptions, type JuceOptions } from './options';
import { resolveJuce } from './resolve-juce';
import { juceScaffoldFiles } from './scaffold';

export type { JuceFormat, JuceOptions, ResolvedJuceOptions } from './options';
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
  readonly platform?: NodeJS.Platform;
}

type Ctx = LifecycleContext<JuceOptions>;
type StandaloneLauncher = (
  target: string,
  platform: NodeJS.Platform,
  logger: Logger,
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
      abiNamespace: nativeAbiNamespace(config.plugin.id),
    }),
  );
}

/** `dev` — debug build, launching the standalone app when it is built. */
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
  const projectDir = ctx.fs.resolve('runtimes', RUNTIME_ID);
  const buildDir = join(ctx.paths.cache, 'build-debug');
  const live = ctx.ui?.live;
  await prepareBuildDir(buildDir, platform, ctx.logger);

  const configureArgs = [
    '-S',
    projectDir,
    '-B',
    buildDir,
    ...generatorArgs(platform),
    `-DJUCE_DIR=${jucePath}`,
    // Always set, so a UI removed since the last configure is not kept cached.
    // A live UI (soundor dev) is loaded from disk and reloaded, not embedded.
    `-DSOUNDOR_UI_DIR=${live === undefined ? (ctx.ui?.dir ?? '') : ''}`,
    `-DSOUNDOR_UI_DEV_DIR=${live === undefined ? '' : ctx.ui!.dir}`,
    `-DSOUNDOR_UI_DEV_LOG=${live?.logFile ?? ''}`,
    // Debug builds are signed ad-hoc: no timestamp server, and a debugger can
    // attach without the hardened runtime in the way.
    ...signingArgs(platform, { identity: '-', source: 'default' }),
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
    args: ['--build', buildDir, '--config', 'Debug'],
    cwd: projectDir,
    logger: ctx.logger,
    signal: ctx.signal,
  });

  if (options.formats.includes('standalone')) {
    await launchStandaloneBuild(
      buildDir,
      ctx,
      deps.launchStandalone ?? launchStandalone,
      deps.platform ?? process.platform,
    );
  }

  ctx.logger.info(
    live === undefined
      ? 'Debug build ready.'
      : 'Debug build ready. The plugin UI reloads on every change; its console appears here.',
  );
  await waitForAbort(ctx.signal);
}

/** `build` — production package: produce VST3/AU under `ctx.paths.dist`. */
export async function juceBuild(
  config: SoundorConfig,
  ctx: Ctx,
  deps: JucePhaseDeps = {},
): Promise<void> {
  const run = deps.run ?? runCommand;
  const platform = deps.platform ?? process.platform;
  const options = resolveJuceOptions(ctx.options, config.plugin);
  const jucePath = await requireJuce(ctx, options);
  requireToolchain(deps.probe ?? probeCommand);
  const projectDir = ctx.fs.resolve('runtimes', RUNTIME_ID);
  const buildDir = join(ctx.paths.cache, 'build-release');
  await prepareBuildDir(buildDir, platform, ctx.logger);

  const configureArgs = [
    '-S',
    projectDir,
    '-B',
    buildDir,
    ...generatorArgs(platform),
    '-DCMAKE_BUILD_TYPE=Release',
    `-DJUCE_DIR=${jucePath}`,
    `-DSOUNDOR_UI_DIR=${ctx.ui?.dir ?? ''}`,
    ...signingArgs(platform, ctx.signing.macos),
  ];
  if (ctx.ui === undefined) {
    ctx.logger.warn(
      'The project has no UI entry (src/main.ts[x]); the plugin view will be empty.',
    );
  }
  if (platform === 'darwin') {
    ctx.logger.info(
      ctx.signing.macos.identity === '-'
        ? 'Signing ad-hoc (set SOUNDOR_MACOS_SIGNING_IDENTITY to distribute the plugin)'
        : `Signing with '${ctx.signing.macos.identity}'`,
    );
  }
  ctx.logger.info('Configuring release build');
  await run({
    cmd: 'cmake',
    args: configureArgs,
    cwd: projectDir,
    logger: ctx.logger,
    signal: ctx.signal,
  });
  await run({
    cmd: 'cmake',
    args: ['--build', buildDir, '--config', 'Release'],
    cwd: projectDir,
    logger: ctx.logger,
    signal: ctx.signal,
  });

  const collected = await collectArtifacts(buildDir, ctx.paths.dist);
  ctx.logger.info(
    collected > 0
      ? `Packaged ${collected} artifact folder(s) into ${ctx.paths.dist}`
      : `Build finished; no *_artefacts found under ${buildDir}`,
  );
}

/** `doctor` — verify CMake, a compiler, and a locatable JUCE checkout. */
export async function juceDoctor(
  config: SoundorConfig,
  ctx: Ctx,
): Promise<DoctorReport> {
  const options = resolveJuceOptions(ctx.options, config.plugin);
  return buildDoctorReport(ctx.fs, options);
}

/** The factory a config author registers: `runtimes: [juceRuntime({ ... })]`. */
export const juceRuntime = defineRuntime<JuceOptions>({
  id: RUNTIME_ID,
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
 * Creates `buildDir`, first deleting it on macOS and Linux when it was
 * configured with a generator other than Ninja (as builds before Soundor chose
 * one were): CMake cannot switch the generator of an existing build tree.
 */
async function prepareBuildDir(
  buildDir: string,
  platform: NodeJS.Platform,
  logger: Logger,
): Promise<void> {
  if (platform !== 'win32') {
    let cache: string | undefined;
    try {
      cache = await readFile(join(buildDir, 'CMakeCache.txt'), 'utf8');
    } catch {
      cache = undefined;
    }
    const generator = cache
      ?.match(/^CMAKE_GENERATOR:INTERNAL=(.*)$/m)?.[1]
      ?.trim();
    if (generator !== undefined && generator !== 'Ninja') {
      logger.info(
        `Recreating ${buildDir}: it was configured for ${generator}, and Soundor builds with Ninja`,
      );
      await rm(buildDir, { recursive: true, force: true });
    }
  }
  await mkdir(buildDir, { recursive: true });
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

async function launchStandaloneBuild(
  buildDir: string,
  ctx: Ctx,
  launch: StandaloneLauncher,
  platform: NodeJS.Platform,
): Promise<void> {
  const target = await findStandaloneTarget(buildDir, platform);
  if (target === undefined) {
    ctx.logger.warn(
      `Standalone build finished, but no app was found under ${buildDir}`,
    );
    return;
  }
  if (launch(target, platform, ctx.logger)) {
    ctx.logger.info(`Launching standalone app: ${target}`);
  }
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
    const target = await findLaunchableInDir(
      join(buildDir, entry.name, 'Standalone'),
      platform,
    );
    if (target !== undefined) return target;
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
): boolean {
  const child = (() => {
    if (platform === 'darwin') {
      return spawn('open', [target], { detached: true, stdio: 'ignore' });
    }
    if (platform === 'win32') {
      return spawn(target, [], {
        cwd: dirname(target),
        detached: true,
        stdio: 'ignore',
        shell: true,
      });
    }
    const env = linuxDesktopEnv();
    if (!canLaunchLinuxGui(env)) {
      logger.warn(
        'Skipping standalone auto-launch: no reachable Linux GUI display was found.',
      );
      logger.warn(`Run manually: ${shellQuote(target)}`);
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
