import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildScripts,
  clearDirectory,
  devScripts,
  projectIdSegment,
  projectManifest,
  resolveProjectTarget,
  tokenReplace,
} from './scaffold';

describe('tokenReplace', () => {
  it('replaces __PROJECT_ID__ with a reverse-DNS segment', () => {
    expect(
      tokenReplace('com.example.__PROJECT_ID__', 'My Synth', ['juce']),
    ).toBe('com.example.my-synth');
  });

  it('replaces __PROJECT_NAME__ with the project name', () => {
    expect(tokenReplace('name: __PROJECT_NAME__', 'my-app', ['juce'])).toBe(
      'name: my-app',
    );
  });

  it('imports and configures a single runtime', () => {
    const input = '__RUNTIME_IMPORTS__;\n  runtimes: __RUNTIMES__,';
    expect(tokenReplace(input, 'my-app', ['juce'])).toBe(
      "import { juceRuntime } from '@soundor/juce-runtime';\n" +
        "  runtimes: [juceRuntime({ formats: ['vst3', 'standalone'] })],",
    );
    expect(tokenReplace(input, 'my-app', ['web'])).toBe(
      "import { webRuntime } from '@soundor/web-runtime';\n" +
        '  runtimes: [webRuntime()],',
    );
  });

  it('imports and configures several runtimes', () => {
    const input = '__RUNTIME_IMPORTS__;\n  runtimes: __RUNTIMES__,';
    expect(tokenReplace(input, 'my-app', ['juce', 'web'])).toBe(
      "import { juceRuntime } from '@soundor/juce-runtime';\n" +
        "import { webRuntime } from '@soundor/web-runtime';\n" +
        "  runtimes: [juceRuntime({ formats: ['vst3', 'standalone'] }), webRuntime()],",
    );
  });

  it('replaces all occurrences', () => {
    const input = '<title>__PROJECT_NAME__</title><h1>__PROJECT_NAME__</h1>';
    expect(tokenReplace(input, 'my-app', ['juce'])).toBe(
      '<title>my-app</title><h1>my-app</h1>',
    );
  });

  it('returns content unchanged when no tokens present', () => {
    const input = 'no tokens here';
    expect(tokenReplace(input, 'my-app', ['juce'])).toBe('no tokens here');
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

describe('projectIdSegment', () => {
  it('lowercases and collapses everything but letters and digits', () => {
    expect(projectIdSegment('@acme/My Synth')).toBe('acme-my-synth');
    expect(projectIdSegment('soundor-demo')).toBe('soundor-demo');
    expect(projectIdSegment('---')).toBe('plugin');
  });
});

describe('devScripts', () => {
  it('gives the first runtime `dev` and the others `dev:<runtime>`', () => {
    expect(devScripts(['juce'])).toEqual({ dev: 'soundor dev juce' });
    expect(devScripts(['web'])).toEqual({ dev: 'soundor dev web' });
    expect(devScripts(['juce', 'web'])).toEqual({
      dev: 'soundor dev juce',
      'dev:web': 'soundor dev web',
    });
  });
});

describe('buildScripts', () => {
  it('builds every runtime, and each one alone when there are several', () => {
    expect(buildScripts(['juce'])).toEqual({ build: 'soundor build' });
    expect(buildScripts(['juce', 'web'])).toEqual({
      build: 'soundor build',
      'build:juce': 'soundor build juce',
      'build:web': 'soundor build web',
    });
  });
});

describe('projectManifest', () => {
  const template = {
    name: '__PROJECT_NAME__',
    scripts: {
      build: 'soundor build',
      dev: 'soundor dev juce',
      gen: 'soundor gen',
      typecheck: 'soundor gen && tsc -b',
    },
    dependencies: {
      '@soundor/juce-runtime': 'workspace:*',
      '@soundor/web-runtime': 'workspace:*',
      react: 'catalog:',
    },
  };
  const versions = {
    '@soundor/juce-runtime': '1.0.0',
    '@soundor/web-runtime': '1.0.0',
    react: '^19.0.0',
  };

  it('keeps only the chosen runtime packages', () => {
    expect(
      projectManifest(template, 'my-app', ['juce'], versions).dependencies,
    ).toEqual({ '@soundor/juce-runtime': '1.0.0', react: '^19.0.0' });
    expect(
      projectManifest(template, 'my-app', ['web'], versions).dependencies,
    ).toEqual({ '@soundor/web-runtime': '1.0.0', react: '^19.0.0' });
  });

  it('runs dev with the first runtime and typechecks the Web host', () => {
    const pkg = projectManifest(template, 'my-app', ['juce', 'web'], versions);
    expect(pkg.name).toBe('my-app');
    expect(pkg.scripts).toEqual({
      build: 'soundor build',
      'build:juce': 'soundor build juce',
      'build:web': 'soundor build web',
      dev: 'soundor dev juce',
      'dev:web': 'soundor dev web',
      gen: 'soundor gen',
      typecheck: 'soundor gen && tsc -b && tsc -p runtimes/web',
    });
  });

  it('leaves the typecheck alone without the web runtime', () => {
    expect(
      projectManifest(template, 'my-app', ['juce'], versions).scripts?.[
        'typecheck'
      ],
    ).toBe('soundor gen && tsc -b');
  });
});
