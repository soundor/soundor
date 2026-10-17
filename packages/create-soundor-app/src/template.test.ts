import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { templateVersions } from '../template-versions';
import { resolveDependencies } from './scaffold';
import { TEMPLATE_VERSIONS } from './versions';

const template = JSON.parse(
  await readFile(
    new URL('../templates/base/package.json', import.meta.url),
    'utf-8',
  ),
) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const isSoundor = (name: string) =>
  name === 'soundor' || name.startsWith('@soundor/');

describe('resolveDependencies', () => {
  const versions = { soundor: '1.2.3', react: '^19.0.0' };

  it('pins workspace packages and takes catalog ranges', () => {
    expect(
      resolveDependencies(
        { soundor: 'workspace:*', react: 'catalog:', other: '^2.0.0' },
        versions,
      ),
    ).toEqual({ soundor: '1.2.3', react: '^19.0.0', other: '^2.0.0' });
  });

  it('fails on a dependency it has no version for', () => {
    expect(() =>
      resolveDependencies({ '@soundor/missing': 'workspace:*' }, versions),
    ).toThrow('create-soundor-app has no version for @soundor/missing');
  });
});

describe('the template', () => {
  const resolved = {
    ...resolveDependencies(template.dependencies),
    ...resolveDependencies(template.devDependencies),
  };

  it('pins every Soundor package exactly, to the workspace version', async () => {
    const soundor = Object.entries(resolved).filter(([name]) =>
      isSoundor(name),
    );
    expect(soundor.length).toBeGreaterThan(0);
    for (const [name, version] of soundor) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
      const manifest = JSON.parse(
        await readFile(
          new URL(`../node_modules/${name}/package.json`, import.meta.url),
          'utf-8',
        ),
      ) as { version: string };
      expect(version, name).toBe(manifest.version);
    }
  });

  it('takes every other dependency from the catalog, never latest', () => {
    for (const [name, specifier] of Object.entries({
      ...template.dependencies,
      ...template.devDependencies,
    })) {
      expect(specifier, name).toBe(
        isSoundor(name) ? 'workspace:*' : 'catalog:',
      );
    }
    for (const version of Object.values(resolved)) {
      expect(version).not.toMatch(/latest|workspace:|catalog:/);
    }
  });

  it('was built with the versions the workspace has now', () => {
    expect(TEMPLATE_VERSIONS).toEqual(templateVersions());
  });
});
