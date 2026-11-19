/**
 * The plugin UI in the form the engine runs, as the JUCE runtime prepares it
 * (its native-ui.ts): the CLI's bundle lowered by the engine's own
 * toNativeModule(), so the lowering always matches the engine the plugin
 * links, in a directory laid out as the engine reads it:
 *
 * - `bundle.js`: a CommonJS module function; a release build compiles it to
 *   Hermes bytecode, `bundle.js.hbc`, with the engine's own hermesc (the
 *   release engine has no compiler);
 * - `bundle.js.map`: in development, mapping it to the original sources;
 * - `assets/<id>`: the bundle's assets;
 * - `build-id`: the CLI's build id, written last (a development build's
 *   editor reloads when it changes).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  appendFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import {
  toNativeModule,
  type NativeModuleOptions,
} from '@soundor/engine/native-module';
import {
  RuntimeError,
  type LiveUiContext,
  type UiBundleContext,
} from '@soundor/runtime-sdk';

export const NATIVE_ENTRY = 'bundle.js';

type SourceMapInput = NonNullable<NativeModuleOptions['inputSourceMap']>;

/** The Hermes compiler of the engine the plugin links, and its revision. */
export interface Bytecode {
  readonly hermesc: string;
  readonly revision: string;
}

export async function writeNativeUi(
  ui: UiBundleContext,
  outDir: string,
  mode: 'development' | 'production',
  bytecode?: Bytecode,
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
  if (bytecode !== undefined) await compileBytecode(outDir, bytecode);
  if (existsSync(join(ui.dir, 'assets')))
    await cp(join(ui.dir, 'assets'), join(outDir, 'assets'), {
      recursive: true,
    });
  const buildId = await readFile(join(ui.dir, 'build-id'), 'utf8').catch(
    () => '',
  );
  await writeFile(join(outDir, 'build-id.tmp'), buildId);
  await rename(join(outDir, 'build-id.tmp'), join(outDir, 'build-id'));
}

/**
 * `bundle.js` → `bundle.js.hbc`, as the engine's SoundorCompileJs.cmake
 * compiles it: named `/bundle.js` (its stack frames' file), with the checks
 * that let the runtime stop it at its time limit, and the epilogue naming
 * the Hermes revision the runtime checks.
 */
async function compileBytecode(
  outDir: string,
  { hermesc, revision }: Bytecode,
): Promise<void> {
  const source = await readFile(join(outDir, NATIVE_ENTRY), 'utf8');
  const named = join(outDir, `${NATIVE_ENTRY}.named.js`);
  const output = join(outDir, `${NATIVE_ENTRY}.hbc`);
  await writeFile(named, `${source}\n//# sourceURL=/${NATIVE_ENTRY}\n`);
  const result = spawnSync(
    hermesc,
    [
      '-O',
      '-fno-inline',
      '-emit-async-break-check',
      '-Wno-undefined-variable',
      '-emit-binary',
      `-out=${output}.tmp`,
      named,
    ],
    { encoding: 'utf8' },
  );
  await rm(named, { force: true });
  if (result.error || result.status !== 0)
    throw new RuntimeError(
      `Compiling the UI to Hermes bytecode failed:\n${result.error?.message ?? `${result.stdout}${result.stderr}`}`,
    );
  await appendFile(`${output}.tmp`, `\nsoundor-hermes ${revision}\n`);
  await rename(`${output}.tmp`, output);
  // The bytecode replaces the source in what is embedded.
  await rm(join(outDir, NATIVE_ENTRY), { force: true });
}

/**
 * Keeps `outDir` the native form of a live (`soundor dev`) UI: written now
 * and after every build the CLI reports; failures go to `onError` and the
 * last good UI stays.
 */
export function watchNativeUi(
  ui: UiBundleContext & { readonly live: LiveUiContext },
  outDir: string,
  onError: (error: unknown) => void,
): { readonly ready: Promise<void>; close(): void } {
  let running: Promise<void> = Promise.resolve();
  let pending = false;
  const update = (): Promise<void> => {
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

/** The files to embed from a native UI directory, by their path in it. */
export async function embeddedFiles(
  outDir: string,
): Promise<{ path: string; file: string }[]> {
  const out: { path: string; file: string }[] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (!/\.(map|mjs)$/.test(entry.name) && entry.name !== 'build-id')
        out.push({ path: relative(outDir, file).split('\\').join('/'), file });
    }
  };
  if (existsSync(outDir)) await walk(outDir);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

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
