/**
 * `@soundor/juce-runtime` — the official reference Soundor runtime.
 *
 * Hosts the React UI in a JUCE `WebBrowserComponent`, binds DSP parameters
 * through an `AudioProcessorValueTreeState`, and owns the build/packaging and
 * dev workflows for VST3/AU. It is the proof the runtime contract works
 * end-to-end. See the package README for the native-call security defaults.
 */

import { cp, mkdir, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import {
  defineRuntime,
  EnvError,
  probeCommand,
  runCommand,
  type CommandProbe,
  type CommandRunner,
  type DoctorReport,
  type LifecycleContext,
  type SoundorConfig,
} from '@soundor/runtime-sdk';

import { generateJuceSources } from './codegen';
import { buildDoctorReport, findCMake, findCppCompiler } from './doctor';
import { resolveJuceOptions, type JuceOptions } from './options';
import { resolveJuce } from './resolve-juce';
import { juceScaffoldFiles } from './scaffold';

export type { JuceFormat, JuceOptions, JucePluginOptions } from './options';
export { generateJuceSources } from './codegen';
export { resolveJuce } from './resolve-juce';
export { buildDoctorReport } from './doctor';

/** The runtime id; must match `config.runtimes[].id`. */
export const RUNTIME_ID = 'juce';

/** Browser module the CLI wires into the UI as `virtual:soundor/bridge`. */
export const BRIDGE_MODULE = '@soundor/juce-runtime/bridge';

/** Injectable toolchain dependencies (defaulted; overridden in tests). */
export interface JucePhaseDeps {
  readonly run?: CommandRunner;
  readonly probe?: CommandProbe;
}

type Ctx = LifecycleContext<JuceOptions>;

/**
 * `init` — scaffold the user-owned host under `runtimes/<id>/` (idempotent).
 * The scaffold inherits the generated framework and `include()`s its
 * `setup.cmake`; it is written once and never overwritten.
 */
export async function juceInit(
  _config: SoundorConfig,
  ctx: Ctx,
): Promise<void> {
  const options = resolveJuceOptions(ctx.options);
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
  const options = resolveJuceOptions(ctx.options);
  const resolution = await resolveJuce(ctx.fs, options);
  ctx.codegen.emitAll(
    generateJuceSources(config, { options, jucePath: resolution.path }),
  );
}

/** `dev` — debug build with the WebView pointed at the Vite dev server. */
export async function juceDev(
  _config: SoundorConfig,
  ctx: Ctx,
  deps: JucePhaseDeps = {},
): Promise<void> {
  const run = deps.run ?? runCommand;
  const probe = deps.probe ?? probeCommand;
  const options = resolveJuceOptions(ctx.options);
  const jucePath = await requireJuce(ctx, options);
  requireToolchain(probe);
  const projectDir = ctx.fs.resolve('runtimes', RUNTIME_ID);
  const devUrl = ctx.dev?.ui?.url;
  const buildDir = join(ctx.paths.cache, 'build-debug');
  await mkdir(buildDir, { recursive: true });

  const configureArgs = [
    '-S',
    projectDir,
    '-B',
    buildDir,
    `-DJUCE_DIR=${jucePath}`,
  ];
  if (devUrl) configureArgs.push(`-DSOUNDOR_DEV_URL=${devUrl}`);

  ctx.logger.info(
    devUrl
      ? `Configuring debug build (UI: ${devUrl})`
      : 'Configuring debug build',
  );
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

  ctx.logger.info('Debug build ready — iterate on the UI via the dev server.');
  await waitForAbort(ctx.signal);
}

/** `build` — production package: embed the CLI-built UI bundle, produce VST3/AU. */
export async function juceBuild(
  _config: SoundorConfig,
  ctx: Ctx,
  deps: JucePhaseDeps = {},
): Promise<void> {
  const run = deps.run ?? runCommand;
  const probe = deps.probe ?? probeCommand;
  const options = resolveJuceOptions(ctx.options);
  const jucePath = await requireJuce(ctx, options);
  requireToolchain(probe);
  const projectDir = ctx.fs.resolve('runtimes', RUNTIME_ID);
  const buildDir = join(ctx.paths.cache, 'build-release');
  await mkdir(buildDir, { recursive: true });

  const configureArgs = [
    '-S',
    projectDir,
    '-B',
    buildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DJUCE_DIR=${jucePath}`,
  ];
  const uiDir = ctx.build?.ui?.dir;
  if (uiDir) configureArgs.push(`-DSOUNDOR_UI_DIR=${uiDir}`);
  else
    ctx.logger.warn(
      'No UI bundle provided by the CLI; building without an embedded UI.',
    );

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
  _config: SoundorConfig,
  ctx: Ctx,
): Promise<DoctorReport> {
  const options = resolveJuceOptions(ctx.options);
  return buildDoctorReport(ctx.fs, options);
}

/** The factory a config author registers: `runtimes: [juceRuntime({ ... })]`. */
export const juceRuntime = defineRuntime<JuceOptions>({
  id: RUNTIME_ID,
  bridgeModule: () => BRIDGE_MODULE,
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
  if (!findCppCompiler(probe)) {
    throw new EnvError(
      'No C++ compiler found. Install a C++ toolchain (Xcode Command Line Tools, MSVC Build Tools, or GCC/Clang) and ensure `c++`, `clang++`, or `g++` is in PATH. Run `soundor doctor` for details.',
    );
  }
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
