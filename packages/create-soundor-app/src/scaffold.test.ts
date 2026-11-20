import {
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  applyTokens,
  buildScripts,
  clearDirectory,
  devScripts,
  projectIdSegment,
  projectManifest,
  resolveProjectTarget,
  tokenReplace,
  type Runtime,
} from './scaffold';

describe('tokenReplace', () => {
  it('replaces __PROJECT_ID__ with a reverse-DNS segment', () => {
    expect(
      tokenReplace('com.example.__PROJECT_ID__', 'My Synth', ['vst3']),
    ).toBe('com.example.my-synth');
  });

  it('replaces __PROJECT_NAME__ with the project name', () => {
    expect(tokenReplace('name: __PROJECT_NAME__', 'my-app', ['vst3'])).toBe(
      'name: my-app',
    );
  });

  it('imports and configures a single runtime', () => {
    const input = '__RUNTIME_IMPORTS__;\n  runtimes: __RUNTIMES__,';
    expect(tokenReplace(input, 'my-app', ['vst3'])).toBe(
      "import { vst3Runtime } from '@soundor/vst3-runtime';\n" +
        '  runtimes: [vst3Runtime()],',
    );
    expect(tokenReplace(input, 'my-app', ['web'])).toBe(
      "import { webRuntime } from '@soundor/web-runtime';\n" +
        '  runtimes: [webRuntime()],',
    );
  });

  it('imports and configures several runtimes', () => {
    const input = '__RUNTIME_IMPORTS__;\n  runtimes: __RUNTIMES__,';
    expect(tokenReplace(input, 'my-app', ['vst3', 'web'])).toBe(
      "import { vst3Runtime } from '@soundor/vst3-runtime';\n" +
        "import { webRuntime } from '@soundor/web-runtime';\n" +
        '  runtimes: [vst3Runtime(), webRuntime()],',
    );
  });

  it('replaces all occurrences', () => {
    const input = '<title>__PROJECT_NAME__</title><h1>__PROJECT_NAME__</h1>';
    expect(tokenReplace(input, 'my-app', ['vst3'])).toBe(
      '<title>my-app</title><h1>my-app</h1>',
    );
  });

  it('returns content unchanged when no tokens present', () => {
    const input = 'no tokens here';
    expect(tokenReplace(input, 'my-app', ['vst3'])).toBe('no tokens here');
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
  it('removes project files while preserving package-manager configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'soundor-scaffold-'));
    try {
      await mkdir(join(root, 'src'));
      await writeFile(join(root, 'src', 'App.tsx'), 'export default null;\n');
      await writeFile(join(root, '.gitignore'), 'dist\n');
      await writeFile(join(root, 'package.json'), '{}\n');
      await writeFile(join(root, '.npmrc'), 'registry=https://example.test\n');
      await writeFile(
        join(root, 'pnpm-workspace.yaml'),
        'minimumReleaseAge: 2880\n',
      );

      await clearDirectory(root);

      expect((await readdir(root)).sort()).toEqual([
        '.npmrc',
        'pnpm-workspace.yaml',
      ]);
      expect(await readFile(join(root, '.npmrc'), 'utf-8')).toBe(
        'registry=https://example.test\n',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe('projectIdSegment', () => {
  it('lowercases and collapses everything but letters and digits', () => {
    expect(projectIdSegment('@acme/My Synth')).toBe('acme-my-synth');
    expect(projectIdSegment('soundor-demo')).toBe('soundor-demo');
    expect(projectIdSegment('---')).toBe('plugin');
  });
});

describe('devScripts', () => {
  it('gives the first runtime `dev` and the others `dev:<runtime>`', () => {
    expect(devScripts(['vst3'])).toEqual({ dev: 'soundor dev vst3' });
    expect(devScripts(['web'])).toEqual({ dev: 'soundor dev web' });
    expect(devScripts(['vst3', 'web'])).toEqual({
      dev: 'soundor dev vst3',
      'dev:web': 'soundor dev web',
    });
  });
});

describe('buildScripts', () => {
  it('builds every runtime, and each one alone when there are several', () => {
    expect(buildScripts(['vst3'])).toEqual({ build: 'soundor build' });
    expect(buildScripts(['vst3', 'web'])).toEqual({
      build: 'soundor build',
      'build:vst3': 'soundor build vst3',
      'build:web': 'soundor build web',
    });
  });
});

describe('projectManifest', () => {
  const template = {
    name: '__PROJECT_NAME__',
    scripts: {
      build: 'soundor build',
      dev: 'soundor dev vst3',
      gen: 'soundor gen',
      typecheck: 'soundor gen && tsc -b',
    },
    dependencies: {
      '@soundor/vst3-runtime': 'workspace:*',
      '@soundor/web-runtime': 'workspace:*',
      react: 'catalog:',
    },
  };
  const versions = {
    '@soundor/vst3-runtime': '1.0.0',
    '@soundor/web-runtime': '1.0.0',
    react: '^19.0.0',
  };

  it('keeps only the chosen runtime packages', () => {
    expect(
      projectManifest(template, 'my-app', ['vst3'], versions).dependencies,
    ).toEqual({ '@soundor/vst3-runtime': '1.0.0', react: '^19.0.0' });
    expect(
      projectManifest(template, 'my-app', ['web'], versions).dependencies,
    ).toEqual({ '@soundor/web-runtime': '1.0.0', react: '^19.0.0' });
  });

  it('adds the VST3 host only to a project with the VST3 runtime', () => {
    const manifest = {
      ...template,
      devDependencies: { '@soundor/vst3-host': 'workspace:*' },
    };
    const pinned = { ...versions, '@soundor/vst3-host': '1.0.0' };
    expect(
      projectManifest(manifest, 'my-app', ['vst3'], pinned).devDependencies,
    ).toEqual({ '@soundor/vst3-host': '1.0.0' });
    expect(
      projectManifest(manifest, 'my-app', ['web'], pinned).devDependencies,
    ).toEqual({});
  });

  it('runs dev with the first runtime and typechecks the Web host', () => {
    const pkg = projectManifest(template, 'my-app', ['vst3', 'web'], versions);
    expect(pkg.name).toBe('my-app');
    expect(pkg.scripts).toEqual({
      build: 'soundor build',
      'build:vst3': 'soundor build vst3',
      'build:web': 'soundor build web',
      dev: 'soundor dev vst3',
      'dev:web': 'soundor dev web',
      gen: 'soundor gen',
      typecheck: 'soundor gen && tsc -b',
    });
  });

  it('leaves the typecheck alone without the web runtime', () => {
    expect(
      projectManifest(template, 'my-app', ['vst3'], versions).scripts?.[
        'typecheck'
      ],
    ).toBe('soundor gen && tsc -b');
  });
});

it.each<{ runtimes: Runtime[] }>([
  { runtimes: ['web'] },
  { runtimes: ['vst3', 'web'] },
  { runtimes: ['vst3'] },
])('keeps solution references valid for %j projects', async ({ runtimes }) => {
  const root = await mkdtemp(join(tmpdir(), 'soundor-template-'));
  try {
    await cp(new URL('../templates/base/', import.meta.url), root, {
      recursive: true,
    });
    await applyTokens(root, 'test-plugin', runtimes);
    const solution = JSON.parse(
      await readFile(join(root, 'tsconfig.json'), 'utf8'),
    ) as { references: { path: string }[] };
    expect(solution.references.map(({ path }) => path)).toEqual([
      './tsconfig.app.json',
      './tsconfig.node.json',
    ]);
    for (const { path } of solution.references)
      expect(await readFile(join(root, path), 'utf8')).toBeTruthy();
    expect((await readdir(root)).includes('runtimes')).toBe(false);
    expect((await readdir(root)).includes('tsconfig.web.json')).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
