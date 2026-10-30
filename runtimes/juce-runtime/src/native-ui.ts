/**
 * The plugin UI in the form the engine runs: the CLI's bundle (one ES module)
 * lowered by the engine's own toNativeModule(), so the lowering always
 * matches the engine the plugin links. The result is a directory of its own,
 * laid out as the engine reads it:
 *
 * - `bundle.js` — a CommonJS module function, the syntax Hermes lacks
 *   lowered; the release build compiles it to bytecode.
 * - `bundle.js.map` — in development, mapping it to the original sources.
 * - `assets/<id>` — the bundle's assets, as they are.
 * - `build-id` — the CLI's build id, written last: when it changes, a
 *   complete new UI is on disk (DevSession reloads on it).
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import {
  toNativeModule,
  type NativeModuleOptions,
} from '@soundor/engine/native-module';
import type { LiveUiContext, UiBundleContext } from '@soundor/runtime-sdk';

/** The file the engine loads the UI from, and its stack frames name. */
export const NATIVE_ENTRY = 'bundle.js';

type SourceMapInput = NonNullable<NativeModuleOptions['inputSourceMap']>;

/**
 * Writes the native form of the UI bundle `ui` into `outDir`. In
 * `development`, with a source map leading to the original sources.
 */
export async function writeNativeUi(
  ui: UiBundleContext,
  outDir: string,
  mode: 'development' | 'production',
): Promise<void> {
  const production = mode === 'production';
  if (production) await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const esm = (await readFile(join(ui.dir, ui.module), 'utf8')).replace(
    /\n\/\/# sourceMappingURL=.*\s*$/,
    '\n',
  );
  const mapFile = join(ui.dir, `${ui.module}.map`);
  const inputSourceMap =
    production || !existsSync(mapFile)
      ? undefined
      : relocate(
          JSON.parse(await readFile(mapFile, 'utf8')) as SourceMapInput,
          ui.dir,
          outDir,
        );
  const native = await toNativeModule(esm, {
    filename: ui.module,
    compact: production,
    sourceMap: inputSourceMap !== undefined,
    ...(inputSourceMap === undefined ? {} : { inputSourceMap }),
  });
  await writeFile(
    join(outDir, NATIVE_ENTRY),
    native.map === undefined
      ? native.code
      : `${native.code}\n//# sourceMappingURL=${NATIVE_ENTRY}.map\n`,
  );
  if (native.map !== undefined)
    await writeFile(
      join(outDir, `${NATIVE_ENTRY}.map`),
      JSON.stringify({ ...native.map, file: NATIVE_ENTRY }),
    );

  if (existsSync(join(ui.dir, 'assets')))
    await cp(join(ui.dir, 'assets'), join(outDir, 'assets'), {
      recursive: true,
    });

  // Last, and atomically: whoever sees a new id sees the complete UI.
  const buildId = await readFile(join(ui.dir, 'build-id'), 'utf8').catch(
    () => '',
  );
  await writeFile(join(outDir, 'build-id.tmp'), buildId);
  await rename(join(outDir, 'build-id.tmp'), join(outDir, 'build-id'));
}

/**
 * Keeps `outDir` the native form of a live (`soundor dev`) UI bundle: writes
 * it now and after every build the CLI reports, one at a time, and has the
 * CLI map the plugin's stack frames through its source map. Failures are
 * reported to `onError`; the last good UI stays. Returns the first write's
 * outcome and a function that stops.
 */
export function watchNativeUi(
  ui: UiBundleContext & { readonly live: LiveUiContext },
  outDir: string,
  onError: (error: unknown) => void,
): { readonly ready: Promise<void>; close(): void } {
  let running: Promise<void> = Promise.resolve();
  let pending = false;
  const update = (): Promise<void> => {
    // Builds landing while one is written collapse into one more write.
    if (pending) return running;
    pending = true;
    running = running.then(async () => {
      pending = false;
      try {
        await writeNativeUi(ui, outDir, 'development');
        const map = join(outDir, `${NATIVE_ENTRY}.map`);
        if (existsSync(map)) await ui.live.sourceMap(`/${NATIVE_ENTRY}`, map);
      } catch (error) {
        onError(error);
      }
    });
    return running;
  };
  const stop = ui.live.onBuild(() => void update());
  return { ready: update(), close: stop };
}

/** A source map's sources, relative to `to` instead of `from`. */
function relocate(
  map: SourceMapInput,
  from: string,
  to: string,
): SourceMapInput {
  const { sourceRoot, ...rest } = map;
  return {
    ...rest,
    sources: map.sources.map((source) =>
      source === null
        ? source
        : relative(to, resolve(from, sourceRoot ?? '', source))
            .split('\\')
            .join('/'),
    ),
  };
}

/** The directory the native form of a UI goes to, under the runtime's cache. */
export function nativeUiDir(cache: string, build: 'debug' | 'release'): string {
  return join(cache, `ui-${build}`);
}
