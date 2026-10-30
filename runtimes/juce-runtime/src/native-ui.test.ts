import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInThisContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchNativeUi, writeNativeUi } from './native-ui';

let root: string;
let ui: { dir: string; module: string };
let out: string;

/** Writes the CLI's bundle: the ES module, maybe its map, then the build id. */
async function writeBundle(
  code: string,
  { buildId = 'build-1', map = false } = {},
): Promise<void> {
  await writeFile(
    join(ui.dir, 'bundle.mjs'),
    map ? `${code}//# sourceMappingURL=bundle.mjs.map\n` : code,
  );
  if (map) {
    // Each line from the same line of src/main.ts, as the CLI's paths go.
    const lines = code.split('\n').length;
    await writeFile(
      join(ui.dir, 'bundle.mjs.map'),
      JSON.stringify({
        version: 3,
        sources: ['../../../src/main.ts'],
        sourcesContent: [code],
        names: [],
        mappings: ['AAAA', ...Array(lines - 1).fill('AACA')].join(';'),
      }),
    );
  }
  await writeFile(join(ui.dir, 'build-id'), buildId);
}

/** Runs the native form as the engine does: a script whose value is the module function. */
function run(native: string): Record<string, unknown> {
  const module = { exports: {} as Record<string, unknown> };
  (
    runInThisContext(native) as (
      exports: object,
      require: (specifier: string) => unknown,
      module: object,
    ) => void
  )(module.exports, () => ({}), module);
  return module.exports;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'juce-native-ui-'));
  ui = {
    dir: join(root, '.soundor', 'ui', 'development'),
    module: 'bundle.mjs',
  };
  out = join(root, '.soundor', 'cache', 'juce', 'ui-debug');
  await mkdir(join(ui.dir, 'assets'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('writeNativeUi', () => {
  it('writes a module function that runs, with the assets and build id', async () => {
    await writeBundle(
      `const values = [3, 1, 2].toSorted();\nexport const result = values.join(',');\n`,
    );
    await writeFile(join(ui.dir, 'assets', 'abc.png'), 'png');

    await writeNativeUi(ui, out, 'production');

    const native = await readFile(join(out, 'bundle.js'), 'utf8');
    expect(run(native)['result']).toBe('1,2,3');
    expect(await readFile(join(out, 'assets', 'abc.png'), 'utf8')).toBe('png');
    expect(await readFile(join(out, 'build-id'), 'utf8')).toBe('build-1');
  });

  it('lowers for Hermes what it cannot compile', async () => {
    await writeBundle(
      `export class Counter { #count = 0; static zero = 0; increment() { return ++this.#count; } }
       export const later = async () => { for (let i = 0; i < 2; i++) await i; return new Counter().increment(); };`,
    );

    await writeNativeUi(ui, out, 'development');

    const native = await readFile(join(out, 'bundle.js'), 'utf8');
    expect(native.startsWith('(function (exports, require, module) {')).toBe(
      true,
    );
    expect(native).not.toMatch(
      /(^|[=(,]\s*)class\b|#count|\blet\s|\bconst\s|async\s*\(/m,
    );
  });

  it('maps the development form to the original sources, from its own directory', async () => {
    await writeBundle(`// a comment\nexport const a = 1;\n`, { map: true });

    await writeNativeUi(ui, out, 'development');

    const native = await readFile(join(out, 'bundle.js'), 'utf8');
    expect(native).toContain('//# sourceMappingURL=bundle.js.map');
    const map = JSON.parse(await readFile(join(out, 'bundle.js.map'), 'utf8'));
    expect(map.file).toBe('bundle.js');
    expect(map.sources.map((source: string) => resolve(out, source))).toContain(
      join(root, 'src', 'main.ts'),
    );
  });

  it('is compact and unmapped in production', async () => {
    await writeBundle(
      `// a comment\nexport const a = 1;\nexport const b = 2;\n`,
      {
        map: true,
      },
    );

    await writeNativeUi(ui, out, 'production');

    const native = await readFile(join(out, 'bundle.js'), 'utf8');
    expect(native).not.toContain('a comment');
    expect(native).not.toContain('sourceMappingURL');
    expect(native.trim().split('\n')).toHaveLength(1);
    await expect(readFile(join(out, 'bundle.js.map'))).rejects.toThrow();
  });
});

describe('watchNativeUi', () => {
  it("follows the CLI's builds, keeping the last good one through an error", async () => {
    await writeBundle(`export const version = 1;\n`, { map: true });
    let onBuild = (): void => {};
    const sourceMap = vi.fn(() => Promise.resolve());
    const errors: unknown[] = [];
    const watcher = watchNativeUi(
      {
        ...ui,
        live: {
          logFile: join(root, 'ui.log'),
          onBuild: (listener) => {
            onBuild = listener;
            return () => {
              onBuild = () => {};
            };
          },
          sourceMap,
        },
      },
      out,
      (error) => errors.push(error),
    );
    const native = (): Promise<string> =>
      readFile(join(out, 'bundle.js'), 'utf8');
    try {
      await watcher.ready;
      expect(run(await native())['version']).toBe(1);
      expect(sourceMap).toHaveBeenCalledWith(
        '/bundle.js',
        join(out, 'bundle.js.map'),
      );

      await writeBundle(`export const version = ;\n`, { buildId: 'build-2' });
      onBuild();
      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(run(await native())['version']).toBe(1);
      expect(await readFile(join(out, 'build-id'), 'utf8')).toBe('build-1');

      await writeBundle(`export const version = 3;\n`, { buildId: 'build-3' });
      onBuild();
      await vi.waitFor(async () =>
        expect(await readFile(join(out, 'build-id'), 'utf8')).toBe('build-3'),
      );
      expect(run(await native())['version']).toBe(3);
    } finally {
      watcher.close();
    }
  });
});
