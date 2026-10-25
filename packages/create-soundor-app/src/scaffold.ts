import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { TEMPLATE_VERSIONS } from './versions';

export interface ProjectTarget {
  readonly isCurrentDirectory: boolean;
  readonly packageName: string;
  readonly targetDir: string;
}

export function resolveProjectTarget(name: string, cwd: string): ProjectTarget {
  if (name === '.') {
    return {
      isCurrentDirectory: true,
      packageName: basename(resolve(cwd)),
      targetDir: resolve(cwd),
    };
  }

  return {
    isCurrentDirectory: false,
    packageName: name,
    targetDir: resolve(cwd, name),
  };
}

export async function clearDirectory(dir: string): Promise<void> {
  const entries = await readdir(dir);
  await Promise.all(
    entries.map((entry) =>
      rm(join(dir, entry), { force: true, recursive: true }),
    ),
  );
}

/**
 * A reverse-DNS segment derived from the project name, for the template's
 * `plugin.id`: `@acme/My Synth` → `acme-my-synth`.
 */
export function projectIdSegment(name: string): string {
  const segment = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return segment.length > 0 ? segment : 'plugin';
}

export const RUNTIMES = ['juce', 'web'] as const;
export type Runtime = (typeof RUNTIMES)[number];

/** What each runtime adds to the project: its package and its config entry. */
export const RUNTIME_INFO: Readonly<
  Record<
    Runtime,
    {
      label: string;
      hint: string;
      package: string;
      factory: string;
      call: string;
    }
  >
> = {
  juce: {
    label: 'JUCE',
    hint: 'VST3, AU and Standalone plugins',
    package: '@soundor/juce-runtime',
    factory: 'juceRuntime',
    call: "juceRuntime({ formats: ['vst3', 'standalone'] })",
  },
  web: {
    label: 'Web',
    hint: 'the plugin in a browser',
    package: '@soundor/web-runtime',
    factory: 'webRuntime',
    call: 'webRuntime()',
  },
};

export function tokenReplace(
  content: string,
  name: string,
  runtimes: readonly Runtime[],
): string {
  return content
    .replaceAll('__PROJECT_NAME__', name)
    .replaceAll('__PROJECT_ID__', projectIdSegment(name))
    .replaceAll(
      '__RUNTIME_IMPORTS__;',
      runtimes
        .map(
          (runtime) =>
            `import { ${RUNTIME_INFO[runtime].factory} } from '${RUNTIME_INFO[runtime].package}';`,
        )
        .join('\n'),
    )
    .replaceAll(
      '__RUNTIMES__',
      `[${runtimes.map((runtime) => RUNTIME_INFO[runtime].call).join(', ')}]`,
    );
}

type Dependencies = Record<string, string>;

/**
 * The template's dependencies with real versions: each `workspace:*` (a
 * Soundor package, pinned exactly) and `catalog:` (a range) replaced from
 * `versions`. A dependency without one is a bug in this package.
 */
export function resolveDependencies(
  dependencies: Dependencies,
  versions: Readonly<Record<string, string>> = TEMPLATE_VERSIONS,
): Dependencies {
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, specifier]) => {
      if (specifier !== 'workspace:*' && specifier !== 'catalog:') {
        return [name, specifier];
      }
      const version = versions[name];
      if (version === undefined) {
        throw new Error(`create-soundor-app has no version for ${name}`);
      }
      return [name, version];
    }),
  );
}

/**
 * The scripts that run each runtime's `soundor dev`: `dev` for the first
 * runtime chosen, `dev:<runtime>` for the others.
 */
export function devScripts(
  runtimes: readonly Runtime[],
): Record<string, string> {
  return Object.fromEntries(
    runtimes.map((runtime, index) => [
      index === 0 ? 'dev' : `dev:${runtime}`,
      `soundor dev ${runtime}`,
    ]),
  );
}

type Manifest = Record<string, unknown> & {
  dependencies?: Dependencies;
  devDependencies?: Dependencies;
  scripts?: Record<string, string>;
};

/**
 * The template's package.json for a project: its name, the chosen runtimes'
 * packages only, their dev scripts, and real dependency versions.
 */
export function projectManifest(
  template: Manifest,
  name: string,
  runtimes: readonly Runtime[],
  versions?: Readonly<Record<string, string>>,
): Manifest {
  const unused = new Set(
    RUNTIMES.filter((runtime) => !runtimes.includes(runtime)).map(
      (runtime) => RUNTIME_INFO[runtime].package,
    ),
  );
  const pkg: Manifest = { ...template, name };
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const dependencies = template[field];
    if (dependencies !== undefined) {
      pkg[field] = resolveDependencies(
        Object.fromEntries(
          Object.entries(dependencies).filter(([dep]) => !unused.has(dep)),
        ),
        versions,
      );
    }
  }
  // The dev scripts take the place of the template's `dev`.
  const scripts: Record<string, string> = {};
  for (const [script, command] of Object.entries(template.scripts ?? {})) {
    if (script === 'dev') {
      Object.assign(scripts, devScripts(runtimes));
    } else if (script === 'typecheck' && runtimes.includes('web')) {
      // The Web host's code has its own tsconfig (DOM types).
      scripts[script] = `${command} && tsc -p runtimes/web`;
    } else {
      scripts[script] = command;
    }
  }
  pkg.scripts = scripts;
  return pkg;
}

export async function applyTokens(
  dir: string,
  name: string,
  runtimes: readonly Runtime[],
): Promise<void> {
  const pkgPath = join(dir, 'package.json');
  const template = JSON.parse(await readFile(pkgPath, 'utf-8')) as Manifest;
  const pkg = projectManifest(template, name, runtimes);
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  for (const rel of ['soundor.config.ts']) {
    const p = join(dir, rel);
    await writeFile(
      p,
      tokenReplace(await readFile(p, 'utf-8'), name, runtimes),
    );
  }
}
