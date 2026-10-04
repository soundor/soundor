import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assetId, bundleUi, findUiEntry } from './bundle';

// Projects live inside this package so `react` (a dev dependency) resolves
// from them, like it would from a real plugin project.
const scratch = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../node_modules/.tmp',
);

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

let root: string;

async function write(
  path: string,
  contents: string | Uint8Array,
): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents);
}

async function bundle(mode: 'development' | 'production' = 'production') {
  const result = await bundleUi({ root, mode, outDir: join(root, 'out') });
  if (result === undefined) throw new Error('expected a bundle');
  const code = await readFile(join(result.dir, 'bundle.js'), 'utf8');
  return { result, code };
}

beforeEach(async () => {
  await mkdir(scratch, { recursive: true });
  root = await mkdtemp(join(scratch, 'ui-bundle-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('findUiEntry', () => {
  it('finds src/main.{tsx,ts,jsx,js} in that order, or nothing', async () => {
    expect(findUiEntry(root)).toBeUndefined();
    await write('src/main.js', '');
    expect(findUiEntry(root)).toBe(join(root, 'src/main.js'));
    await write('src/main.ts', '');
    expect(findUiEntry(root)).toBe(join(root, 'src/main.ts'));
    await write('src/main.tsx', '');
    expect(findUiEntry(root)).toBe(join(root, 'src/main.tsx'));
  });
});

describe('bundleUi', () => {
  it('returns undefined for a project without a UI', async () => {
    expect(
      await bundleUi({ root, mode: 'production', outDir: join(root, 'out') }),
    ).toBeUndefined();
  });

  it('bundles a TypeScript entry into one ES module, keeping soundor:* imports', async () => {
    await write(
      'src/main.ts',
      `import { parameters } from 'soundor:parameters';
       import { plugin } from 'soundor:host';
       import { label } from './label';
       const gain: number = parameters.gain.get();
       console.info(label(plugin.name, gain));`,
    );
    await write(
      'src/label.ts',
      `export const label = (name: string, gain: number): string => \`\${name}: \${gain}\`;`,
    );
    const { result, code } = await bundle();
    expect(result.entry).toBe('bundle.js');
    expect(code).toMatch(/from\s*["']soundor:parameters["']/);
    expect(code).toMatch(/from\s*["']soundor:host["']/);
    expect(code).not.toContain('./label');
    expect(code).not.toMatch(/:\s*number/); // types are gone
  });

  it('inlines npm packages', async () => {
    await write(
      'node_modules/fake-lib/package.json',
      JSON.stringify({ name: 'fake-lib', type: 'module', main: 'index.js' }),
    );
    await write(
      'node_modules/fake-lib/index.js',
      'export const answer = () => 42;',
    );
    await write(
      'package.json',
      JSON.stringify({
        name: 'p',
        type: 'module',
        dependencies: { 'fake-lib': '1.0.0' },
      }),
    );
    await write(
      'src/main.ts',
      `import { answer } from 'fake-lib'; globalThis.out = answer();`,
    );
    const { code } = await bundle();
    expect(code).not.toContain('fake-lib');
    expect(code).toContain('42');
  });

  it('compiles TSX with React, resolving NODE_ENV at build time', async () => {
    await write(
      'src/main.tsx',
      `import { useState } from 'react';
       function Counter() { const [count] = useState(1); return <counter value={count} />; }
       globalThis.element = <Counter />;`,
    );
    await write(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }),
    );
    const { code } = await bundle();
    expect(code).not.toMatch(/\bprocess\b/);
    expect(code).not.toContain('<Counter');
    expect(code).toMatch(/react\.transitional\.element|react\.element/);
  });

  it('minifies in production and maps sources in development', async () => {
    await write(
      'src/main.ts',
      `// a comment\nexport function greet(name: string) {\n  return 'hello ' + name;\n}\nglobalThis.greet = greet;\n`,
    );
    const production = await bundle('production');
    expect(production.code).not.toContain('a comment');
    expect(production.code.trim().split('\n').length).toBeLessThanOrEqual(2);
    await expect(
      readFile(join(production.result.dir, 'bundle.js.map')),
    ).rejects.toThrow();

    const development = await bundle('development');
    expect(development.code).toContain('//# sourceMappingURL=bundle.js.map');
    const map = JSON.parse(
      await readFile(join(development.result.dir, 'bundle.js.map'), 'utf8'),
    );
    expect(
      map.sources.some((source: string) => source.endsWith('src/main.ts')),
    ).toBe(true);
    expect(map.sourcesContent.join('')).toContain('a comment');
  });

  it('turns image imports into content-addressed assets', async () => {
    await write('src/logo.png', PNG);
    await write('src/copy-of-logo.png', PNG);
    await write('src/photo.JPEG', Uint8Array.from([0xff, 0xd8, 0xff, 9]));
    await write(
      'src/main.ts',
      `import logo from './logo.png'; import again from './copy-of-logo.png'; import photo from './photo.JPEG';
       globalThis.assets = [logo, again, photo];`,
    );
    const { result, code } = await bundle();
    const logoId = assetId(PNG, 'logo.png');
    expect(logoId).toMatch(/^[0-9a-f]{16}\.png$/);
    expect(code).toContain(logoId);
    expect(result.assets.map((asset) => asset.id)).toEqual(
      [
        logoId,
        assetId(Uint8Array.from([0xff, 0xd8, 0xff, 9]), 'x.jpeg'),
      ].sort(),
    );
    expect(
      new Uint8Array(await readFile(join(result.dir, 'assets', logoId))),
    ).toEqual(PNG);
    const manifest = JSON.parse(
      await readFile(join(result.dir, 'manifest.json'), 'utf8'),
    );
    expect(manifest.entry).toBe('bundle.js');
    expect(
      manifest.assets.find((asset: { id: string }) => asset.id === logoId),
    ).toMatchObject({
      type: 'image/png',
      size: PNG.length,
    });
  });

  it('is deterministic', async () => {
    await write('src/logo.png', PNG);
    await write(
      'src/main.ts',
      `import logo from './logo.png'; globalThis.logo = logo;`,
    );
    const first = await bundle();
    const firstManifest = await readFile(
      join(first.result.dir, 'manifest.json'),
      'utf8',
    );
    const second = await bundle();
    expect(second.code).toBe(first.code);
    expect(
      await readFile(join(second.result.dir, 'manifest.json'), 'utf8'),
    ).toBe(firstManifest);
  });

  it('produces a bundle that runs', async () => {
    await write(
      'src/main.ts',
      `const values = [3, 1, 2].toSorted(); export const result = values.join(',');`,
    );
    const { result } = await bundle();
    const module = await import(join(result.dir, 'bundle.js'));
    expect(module.result).toBe('1,2,3');
  });

  it('reports build errors', async () => {
    await write(
      'src/main.ts',
      `import { missing } from './nowhere';\nmissing();`,
    );
    await expect(bundle()).rejects.toThrow(/nowhere/);
  });
});
