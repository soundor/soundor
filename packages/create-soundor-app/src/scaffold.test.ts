import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { clearDirectory, resolveProjectTarget, tokenReplace } from './scaffold';

describe('tokenReplace', () => {
  it('replaces __PROJECT_NAME__ with the project name', () => {
    expect(tokenReplace('name: __PROJECT_NAME__', 'my-app', 'juce')).toBe(
      'name: my-app',
    );
  });

  it('replaces __RUNTIME__ with the runtime', () => {
    expect(tokenReplace('runtime: __RUNTIME__', 'my-app', 'juce')).toBe(
      'runtime: juce',
    );
  });

  it('replaces all occurrences', () => {
    const input = '<title>__PROJECT_NAME__</title><h1>__PROJECT_NAME__</h1>';
    expect(tokenReplace(input, 'my-app', 'juce')).toBe(
      '<title>my-app</title><h1>my-app</h1>',
    );
  });

  it('replaces both tokens in the same string', () => {
    const input = 'name: __PROJECT_NAME__, runtime: __RUNTIME__';
    expect(tokenReplace(input, 'soundor-demo', 'juce')).toBe(
      'name: soundor-demo, runtime: juce',
    );
  });

  it('returns content unchanged when no tokens present', () => {
    const input = 'no tokens here';
    expect(tokenReplace(input, 'my-app', 'juce')).toBe('no tokens here');
  });
});

describe('resolveProjectTarget', () => {
  it('uses the current directory for dot projects', () => {
    expect(resolveProjectTarget('.', '/tmp/my-plugin')).toEqual({
      isCurrentDirectory: true,
      packageName: 'my-plugin',
      targetDir: '/tmp/my-plugin',
    });
  });

  it('uses a child directory for named projects', () => {
    expect(resolveProjectTarget('my-app', '/tmp/workspace')).toEqual({
      isCurrentDirectory: false,
      packageName: 'my-app',
      targetDir: '/tmp/workspace/my-app',
    });
  });
});

describe('clearDirectory', () => {
  it('removes every direct entry in a directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'soundor-scaffold-'));
    try {
      await mkdir(join(root, 'src'));
      await writeFile(join(root, 'src', 'App.tsx'), 'export default null;\n');
      await writeFile(join(root, '.gitignore'), 'dist\n');
      await writeFile(join(root, 'package.json'), '{}\n');

      await clearDirectory(root);

      await expect(readdir(root)).resolves.toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
