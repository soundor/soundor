import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { syncExamples } from './examples.ts';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

/**
 * A workspace: the site depends on `deps`, linked from where they live
 * (`examples/<name>` or `packages/<name>`); `built` examples have a web build.
 */
function workspace(deps: Record<string, string>, built: string[]): string {
  root = mkdtempSync(join(tmpdir(), 'workspace-'));
  const site = join(root, 'apps/site');
  mkdirSync(join(site, 'node_modules'), { recursive: true });
  writeFileSync(
    join(site, 'package.json'),
    JSON.stringify({
      devDependencies: Object.fromEntries(
        Object.keys(deps).map((name) => [name, 'workspace:*']),
      ),
    }),
  );
  for (const [name, dir] of Object.entries(deps)) {
    const target = join(root, dir);
    mkdirSync(target, { recursive: true });
    mkdirSync(join(target, 'src/ui'), { recursive: true });
    writeFileSync(join(target, 'src/main.tsx'), `// ${name}`);
    writeFileSync(join(target, 'src/ui/Knob.tsx'), 'export {};');
    writeFileSync(join(target, 'src/App.test.tsx'), 'test');
    if (built.includes(name)) {
      mkdirSync(join(target, '.soundor/dist/web/assets'), { recursive: true });
      writeFileSync(join(target, '.soundor/dist/web/index.html'), name);
      writeFileSync(join(target, '.soundor/dist/web/assets/app.js'), '');
    }
    symlinkSync(target, join(site, 'node_modules', name));
  }
  return site;
}

describe('syncExamples', () => {
  it("copies the examples' web builds, and only examples", () => {
    const site = workspace(
      {
        basic: 'examples/basic',
        primitives: 'examples/primitives',
        tools: 'packages/tools',
      },
      ['basic', 'primitives', 'tools'],
    );
    expect(syncExamples(site)).toEqual(['basic', 'primitives']);
    expect(
      readFileSync(join(site, 'public/examples/basic/index.html'), 'utf-8'),
    ).toBe('basic');
    expect(existsSync(join(site, 'public/examples/basic/assets/app.js'))).toBe(
      true,
    );
    expect(existsSync(join(site, 'public/examples/tools'))).toBe(false);
  });

  it('writes the UI sources the editor opens, without tests', () => {
    const site = workspace({ basic: 'examples/basic' }, ['basic']);
    syncExamples(site);
    expect(
      JSON.parse(
        readFileSync(
          join(site, 'public/examples/basic/playground.json'),
          'utf-8',
        ),
      ),
    ).toEqual({
      entry: 'src/main.tsx',
      files: { 'src/main.tsx': '// basic', 'src/ui/Knob.tsx': 'export {};' },
    });
  });

  it('replaces what an earlier sync copied', () => {
    const site = workspace({ basic: 'examples/basic' }, ['basic']);
    mkdirSync(join(site, 'public/examples/removed'), { recursive: true });
    syncExamples(site);
    expect(existsSync(join(site, 'public/examples/removed'))).toBe(false);
  });

  it('fails, saying how to build it, when an example has no web build', () => {
    const site = workspace({ basic: 'examples/basic' }, []);
    expect(() => syncExamples(site)).toThrow(
      /basic has no web build .*pnpm turbo run build --filter=website/,
    );
  });
});
