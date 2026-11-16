/**
 * `@soundor/web-runtime` — runs a Soundor plugin in the browser.
 *
 * The plugin contract generated from soundor.config is implemented with
 * browser services and the same Rust controller/processor through WASM. The
 * package owns the Web host; gen emits the project manifest and dev/build
 * run Vite on the installed host.
 * The plugin UI is the bundle the CLI builds (`ctx.ui`), which the host loads
 * as it is.
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  ConfigError,
  defineRuntime,
  EnvError,
  RuntimeError,
  type DoctorReport,
  type LifecycleContext,
  type Logger,
  type ResolvedSoundorConfig,
} from '@soundor/runtime-sdk';
import {
  build as viteBuild,
  createServer as viteCreateServer,
  type InlineConfig,
  type Logger as ViteLogger,
} from 'vite';

import { generateWebSources } from './codegen';
import { buildWebDoctorReport } from './doctor';
import { resolveWebOptions, type WebOptions } from './options';
import { HOST_DIR } from './paths';
import { PROCESSOR_MODULE, soundorWebPlugin } from './plugin';

export type { BuiltinInput } from './input-options';
export type { WebOptions, ResolvedWebOptions } from './options';
export type {
  WebEditor,
  WebManifest,
  WebParameterInfo,
} from './client/manifest';
export { generateWebSources, webManifest } from './codegen';
export { buildWebDoctorReport } from './doctor';

/** The runtime id; must match `config.runtimes[].id`. */
export const RUNTIME_ID = 'web';

/** Injectable Vite entry points (defaulted; overridden in tests). */
export interface WebPhaseDeps {
  readonly createServer?: typeof viteCreateServer;
  readonly build?: typeof viteBuild;
  /** This package's browser code (defaults to the installed one). */
  readonly clientDir?: string;
}

type Ctx = LifecycleContext<WebOptions>;

/** The shared lifecycle requires init; the managed Web host needs no files. */
export async function webInit(
  _config: ResolvedSoundorConfig,
  ctx: Ctx,
): Promise<void> {
  resolveWebOptions(ctx.options);
}

/** `gen` — emit the project's manifest into `.soundor/generated/runtimes/<id>/`. */
export async function webGen(
  config: ResolvedSoundorConfig,
  ctx: Ctx,
): Promise<void> {
  resolveWebOptions(ctx.options);
  ctx.codegen.emitAll(generateWebSources(config));
}

/** `dev` — serve the Web host with Vite until `ctx.signal` aborts. */
export async function webDev(
  config: ResolvedSoundorConfig,
  ctx: Ctx,
  deps: WebPhaseDeps = {},
): Promise<void> {
  const options = resolveWebOptions(ctx.options);
  await validateProject(ctx);
  const processor = await buildProcessor(ctx);
  const createServer = deps.createServer ?? viteCreateServer;
  let server: Awaited<ReturnType<typeof viteCreateServer>>;
  try {
    server = await createServer({
      ...viteConfig(config, ctx, deps, processor),
      mode: 'development',
      server: { port: options.port },
    });
  } catch (error) {
    throw viteFailure('start the Web host dev server', 'dev', error);
  }
  // The audio processing changed: Cargo again, then the page reloads with it.
  let rebuilding = Promise.resolve();
  const stopWatching = ctx.native?.onChange?.(() => {
    rebuilding = rebuilding.then(async () => {
      ctx.logger.info(
        'The native crate changed; rebuilding the audio processor',
      );
      try {
        await buildProcessor(ctx);
        const module = server.moduleGraph.getModuleById(
          `\0${PROCESSOR_MODULE}`,
        );
        if (module !== undefined) server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: 'full-reload' });
        ctx.logger.info('Rebuilt the audio processor; the page reloads.');
      } catch (error) {
        if (!ctx.signal.aborted)
          ctx.logger.error(
            `The audio processor could not be rebuilt; fix the error and save again.\n${error instanceof Error ? error.message : String(error)}`,
          );
      }
    });
  });
  try {
    if (ctx.signal.aborted) return;
    try {
      await server.listen();
    } catch (error) {
      throw viteFailure('start the Web host dev server', 'dev', error);
    }
    const url = server.resolvedUrls?.local[0];
    if (ctx.session === undefined)
      ctx.logger.info(
        url === undefined ? 'Web host ready.' : `Web host ready: ${url}`,
      );
    else {
      if (url !== undefined)
        ctx.session.shortcut({
          key: 'w',
          description: 'open the Web host in a browser',
          action: () => server.openBrowser(),
        });
      ctx.session.ready(
        url === undefined ? [] : [{ label: 'Web host', value: url }],
      );
    }
    await waitForAbort(ctx.signal);
  } finally {
    stopWatching?.();
    // Closes Vite's watchers and connections too, so the process can exit.
    await server.close();
  }
}

/** `build` — a static Web host site under `ctx.paths.dist`. */
export async function webBuild(
  config: ResolvedSoundorConfig,
  ctx: Ctx,
  deps: WebPhaseDeps = {},
): Promise<void> {
  resolveWebOptions(ctx.options);
  await validateProject(ctx);
  if (ctx.ui === undefined) {
    ctx.logger.warn(
      'The project has no UI entry (src/main.ts[x]); the plugin view will be empty.',
    );
  }
  const processor = await buildProcessor(ctx);
  const build = deps.build ?? viteBuild;
  try {
    await build({
      ...viteConfig(config, ctx, deps, processor),
      mode: 'production',
    });
  } catch (error) {
    throw viteFailure('build the Web host', 'build', error);
  }
  ctx.logger.info(`Built the Web host -> ${ctx.paths.dist}`);
}

/** `doctor` — Node.js, Vite, Rust and managed-host migration. */
export async function webDoctor(
  _config: ResolvedSoundorConfig,
  ctx: Ctx,
): Promise<DoctorReport> {
  resolveWebOptions(ctx.options);
  return buildWebDoctorReport(ctx.fs, RUNTIME_ID);
}

/** The factory a config author registers: `runtimes: [webRuntime({ ... })]`. */
export const webRuntime = defineRuntime<WebOptions>({
  id: RUNTIME_ID,
  init: webInit,
  gen: webGen,
  dev: (config, ctx) => webDev(config, ctx),
  build: (config, ctx) => webBuild(config, ctx),
  doctor: webDoctor,
});

export default webRuntime;

/**
 * The package-owned host and explicit plugin project paths for every Vite run.
 */
function viteConfig(
  config: ResolvedSoundorConfig,
  ctx: Ctx,
  deps: WebPhaseDeps,
  processor: string,
): InlineConfig {
  const hostDir = HOST_DIR;
  return {
    root: hostDir,
    configFile: false,
    publicDir: ctx.fs.resolve('public'),
    cacheDir: ctx.fs.resolve('.soundor', 'cache', 'vite'),
    logLevel: 'info',
    customLogger: viteLogger(ctx.logger),
    plugins: [
      soundorWebPlugin({
        hostDir,
        projectRoot: ctx.fs.resolve(),
        inputs: ctx.options.inputs,
        genDir: ctx.paths.gen,
        outDir: ctx.paths.dist,
        clientDir: deps.clientDir,
        ui: ctx.ui,
        processor,
        pluginName: config.plugin.name,
        environmentMode:
          ctx.mode === 'production' ? 'production' : 'development',
      }),
    ],
  };
}

/** Vite's own error, as a runtime error naming what failed. */
function viteFailure(
  what: string,
  phase: 'dev' | 'build',
  error: unknown,
): RuntimeError {
  return new RuntimeError(
    `Vite failed to ${what}: ${error instanceof Error ? error.message : String(error)}`,
    { runtimeId: RUNTIME_ID, phase, cause: error },
  );
}

/** The WebAssembly target the audio processor is compiled for. */
export const WASM_TARGET = 'wasm32-unknown-unknown';

/**
 * Compiles the project's Rust crate (native/), the plugin's audio
 * processing, to WebAssembly: always optimized, as it runs in real time.
 */
async function buildProcessor(ctx: Ctx): Promise<string> {
  if (ctx.native === undefined)
    throw new EnvError(
      "The project has no Rust crate (native/Cargo.toml), which holds the plugin's audio processing. Run `soundor init` to create it.",
    );
  ctx.logger.info('Compiling the audio processing (native/) to WebAssembly');
  const library = await ctx.native.build({
    crateType: 'cdylib',
    target: WASM_TARGET,
    profile: 'release',
  });
  return library.path;
}

async function validateProject(ctx: Ctx): Promise<void> {
  if (await ctx.fs.exists(ctx.fs.resolve('runtimes', RUNTIME_ID))) {
    throw new ConfigError(
      'validation',
      "The Web host is now managed by @soundor/web-runtime. Move custom inputs from runtimes/web to a browser module and set webRuntime({ inputs: './web/inputs.ts' }). Migrate other host customizations, then remove runtimes/web yourself. Existing files are never deleted; the legacy host cannot be combined with the managed host. See https://soundor.dev/docs/web-runtime#migration.",
    );
  }
  const inputs = resolveWebOptions(ctx.options).inputs;
  if (typeof inputs === 'string') {
    const path = resolve(ctx.fs.resolve(), inputs);
    if (
      !/\.[cm]?[jt]s$/.test(path) ||
      !(await stat(path).catch(() => undefined))?.isFile()
    )
      throw new ConfigError(
        'validation',
        `Web input module not found or not JavaScript/TypeScript: ${inputs} (resolved from ${ctx.fs.resolve()})`,
      );
  }
}

/** Vite's output, through the runtime's logger. */
function viteLogger(logger: Logger): ViteLogger {
  const warned = new Set<string>();
  let errorLogged = false;
  const self: ViteLogger = {
    hasWarned: false,
    info: (message) => logger.info(message),
    warn: (message) => {
      self.hasWarned = true;
      logger.warn(message);
    },
    warnOnce: (message) => {
      if (warned.has(message)) return;
      warned.add(message);
      self.warn(message);
    },
    error: (message, options) => {
      errorLogged = true;
      logger.error(message);
      if (options?.error?.stack) logger.debug(options.error.stack);
    },
    clearScreen: () => {},
    hasErrorLogged: () => errorLogged,
  };
  return self;
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
