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
import { join, resolve } from 'node:path';

import {
  ConfigError,
  defineRuntime,
  EnvError,
  logNotices,
  RuntimeError,
  writeNotices,
  type DoctorReport,
  type LicensesReport,
  type LifecycleContext,
  type Logger,
  type ResolvedSoundorConfig,
} from '@soundor/runtime-sdk';
import {
  build as viteBuild,
  createServer as viteCreateServer,
  type InlineConfig,
  type Logger as ViteLogger,
  type Plugin,
} from 'vite';

import { generateWebSources } from './codegen';
import { buildWebDoctorReport } from './doctor';
import { engineWasmLicenses } from './engine-wasm';
import { modulesCollector, webNotices } from './notices';
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
  /** The engine module's notices (defaults to the installed engine's). */
  readonly engineLicenses?: typeof engineWasmLicenses;
}

type Ctx = LifecycleContext<WebOptions>;

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
  const processor = await buildLibrary(ctx);
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
  // The Rust library changed: Cargo again, then the page reloads with it.
  let rebuilding = Promise.resolve();
  const stopWatching = ctx.lib?.onChange?.(() => {
    rebuilding = rebuilding.then(async () => {
      ctx.logger.info('The Rust library changed; rebuilding the Rust library');
      try {
        await buildLibrary(ctx);
        const module = server.moduleGraph.getModuleById(
          `\0${PROCESSOR_MODULE}`,
        );
        if (module !== undefined) server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: 'full-reload' });
        ctx.logger.info('Rebuilt the Rust library; the page reloads.');
      } catch (error) {
        if (!ctx.signal.aborted)
          ctx.logger.error(
            `The Rust library could not be rebuilt; fix the error and save again.\n${error instanceof Error ? error.message : String(error)}`,
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
  const processor = await buildLibrary(ctx);
  const build = deps.build ?? viteBuild;
  const modules = new Set<string>();
  try {
    await build({
      ...viteConfig(config, ctx, deps, processor, [modulesCollector(modules)]),
      mode: 'production',
    });
  } catch (error) {
    throw viteFailure('build the Web host', 'build', error);
  }
  const notices = await noticesOf(config, ctx, modules, deps);
  await writeNotices(join(ctx.paths.dist, 'licenses'), notices.notices, {
    title: config.plugin.name,
  });
  logNotices(ctx.logger, notices, 'licenses/');
  ctx.logger.info(`Built the Web host -> ${ctx.paths.dist}`);
}

/** What a web build of the project contains that has a notice (notices.ts). */
async function noticesOf(
  config: ResolvedSoundorConfig,
  ctx: Ctx,
  pageModules: Iterable<string>,
  deps: WebPhaseDeps,
): Promise<LicensesReport> {
  return webNotices({
    config,
    root: ctx.fs.resolve(),
    pageModules,
    ...(ctx.ui === undefined ? {} : { ui: ctx.ui }),
    ...(ctx.lib === undefined ? {} : { lib: ctx.lib }),
    rustTarget: WASM_TARGET,
    engineLicenses: await (deps.engineLicenses ?? engineWasmLicenses)(),
  });
}

/**
 * `licenses` — the notices a build would ship, without building: the host
 * page is bundled in memory to see what it contains, the Rust library is
 * not compiled (Cargo resolves its crates).
 */
export async function webLicenses(
  config: ResolvedSoundorConfig,
  ctx: Ctx,
  deps: WebPhaseDeps = {},
): Promise<LicensesReport> {
  resolveWebOptions(ctx.options);
  await validateProject(ctx);
  const build = deps.build ?? viteBuild;
  const modules = new Set<string>();
  try {
    await build({
      // Never into the build's directory, though nothing is written.
      ...viteConfig(
        config,
        ctx,
        deps,
        undefined,
        [modulesCollector(modules)],
        ctx.fs.resolve('.soundor', 'cache', 'licenses', RUNTIME_ID),
      ),
      mode: 'production',
      logLevel: 'warn',
      build: { write: false },
    });
  } catch (error) {
    throw viteFailure('bundle the Web host', 'build', error);
  }
  return noticesOf(config, ctx, modules, deps);
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
  gen: webGen,
  dev: (config, ctx) => webDev(config, ctx),
  build: (config, ctx) => webBuild(config, ctx),
  doctor: webDoctor,
  licenses: (config, ctx) => webLicenses(config, ctx),
});

export default webRuntime;

/**
 * The package-owned host and explicit plugin project paths for every Vite run.
 */
function viteConfig(
  config: ResolvedSoundorConfig,
  ctx: Ctx,
  deps: WebPhaseDeps,
  processor: string | undefined,
  extra: readonly Plugin[] = [],
  outDir: string = ctx.paths.dist,
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
        outDir,
        clientDir: deps.clientDir,
        ui: ctx.ui,
        ...(processor === undefined ? {} : { processor }),
        pluginName: config.plugin.name,
        environmentMode:
          ctx.mode === 'production' ? 'production' : 'development',
      }),
      ...extra,
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
 * Compiles the project's Rust library (lib/), the plugin's processor
 * and controller, to WebAssembly: always optimized, as it runs in real time.
 */
async function buildLibrary(ctx: Ctx): Promise<string> {
  if (ctx.lib === undefined)
    throw new EnvError(
      "The project has no Rust library (lib/Cargo.toml), which holds the plugin's processor and controller. Run `soundor gen` to create missing Rust starter files.",
    );
  ctx.logger.info('Compiling the Rust library (lib/) to WebAssembly');
  const library = await ctx.lib.build({
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
