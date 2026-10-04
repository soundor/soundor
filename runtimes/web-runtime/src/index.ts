/**
 * `@soundor/web-runtime` — runs a Soundor plugin in the browser.
 *
 * The plugin contract generated from soundor.config is implemented with
 * TypeScript and browser APIs instead of C++ and JUCE. `init` scaffolds a
 * user-owned Web host project under `runtimes/web/`, `gen` emits the project's
 * manifest, and `dev` and `build` run Vite programmatically on that project.
 * The plugin UI is the bundle the CLI builds (`ctx.ui`), which the host loads
 * as it is.
 */

import { join, relative, sep } from 'node:path';

import {
  ConfigError,
  defineRuntime,
  type DoctorReport,
  type LifecycleContext,
  type Logger,
  type SoundorConfig,
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
import { soundorWebPlugin } from './plugin';
import { webScaffoldFiles } from './scaffold';

export type { WebOptions, ResolvedWebOptions } from './options';
export type { WebManifest, WebParameterInfo } from './client/manifest';
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

/**
 * `init` — scaffold the user-owned Web host under `runtimes/<id>/`
 * (idempotent): files that exist are never overwritten.
 */
export async function webInit(config: SoundorConfig, ctx: Ctx): Promise<void> {
  resolveWebOptions(ctx.options);
  const scaffoldDir = ctx.fs.resolve('runtimes', RUNTIME_ID);
  const generatedPath = relative(scaffoldDir, join(ctx.paths.gen, '..', '..'))
    .split(sep)
    .join('/');
  const files = webScaffoldFiles(RUNTIME_ID, {
    pluginName: config.plugin.name,
    generatedPath,
  });

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

/** `gen` — emit the project's manifest into `.soundor/generated/runtimes/<id>/`. */
export async function webGen(config: SoundorConfig, ctx: Ctx): Promise<void> {
  resolveWebOptions(ctx.options);
  ctx.codegen.emitAll(generateWebSources(config));
}

/** `dev` — serve the Web host with Vite until `ctx.signal` aborts. */
export async function webDev(
  config: SoundorConfig,
  ctx: Ctx,
  deps: WebPhaseDeps = {},
): Promise<void> {
  const options = resolveWebOptions(ctx.options);
  await requireScaffold(ctx);
  const createServer = deps.createServer ?? viteCreateServer;
  const server = await createServer({
    ...viteConfig(config, ctx, deps),
    mode: 'development',
    server: { port: options.port },
  });
  try {
    if (ctx.signal.aborted) return;
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    ctx.logger.info(
      url === undefined ? 'Web host ready.' : `Web host ready: ${url}`,
    );
    await waitForAbort(ctx.signal);
  } finally {
    await server.close();
  }
}

/** `build` — a static Web host site under `ctx.paths.dist`. */
export async function webBuild(
  config: SoundorConfig,
  ctx: Ctx,
  deps: WebPhaseDeps = {},
): Promise<void> {
  resolveWebOptions(ctx.options);
  await requireScaffold(ctx);
  if (ctx.ui === undefined) {
    ctx.logger.warn(
      'The project has no UI entry (src/main.ts[x]); the plugin view will be empty.',
    );
  }
  const build = deps.build ?? viteBuild;
  await build({ ...viteConfig(config, ctx, deps), mode: 'production' });
  ctx.logger.info(`Built the Web host -> ${ctx.paths.dist}`);
}

/** `doctor` — Node.js, Vite and the scaffolded Web host project. */
export async function webDoctor(
  _config: SoundorConfig,
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
 * What every Vite run gets from the lifecycle. The project's own
 * `vite.config.ts` (found in the host directory) is merged in by Vite; the
 * Soundor plugin then fixes what it must not change.
 */
function viteConfig(
  config: SoundorConfig,
  ctx: Ctx,
  deps: WebPhaseDeps,
): InlineConfig {
  const hostDir = ctx.fs.resolve('runtimes', RUNTIME_ID);
  return {
    root: hostDir,
    logLevel: 'info',
    customLogger: viteLogger(ctx.logger),
    plugins: [
      soundorWebPlugin({
        hostDir,
        genDir: ctx.paths.gen,
        outDir: ctx.paths.dist,
        clientDir: deps.clientDir,
        ui: ctx.ui,
        pluginName: config.plugin.name,
      }),
    ],
  };
}

async function requireScaffold(ctx: Ctx): Promise<void> {
  const index = ctx.fs.resolve('runtimes', RUNTIME_ID, 'index.html');
  if (!(await ctx.fs.exists(index))) {
    throw new ConfigError(
      'not-found',
      `The Web host project is missing (runtimes/${RUNTIME_ID}/index.html). Run \`soundor init ${RUNTIME_ID}\` to scaffold it.`,
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
