import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

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

export function tokenReplace(
  content: string,
  name: string,
  runtime: string,
): string {
  return content
    .replaceAll('__PROJECT_NAME__', name)
    .replaceAll('__PROJECT_ID__', projectIdSegment(name))
    .replaceAll('__RUNTIME__', runtime);
}

export async function applyTokens(
  dir: string,
  name: string,
  runtime: string,
): Promise<void> {
  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as Record<
    string,
    unknown
  >;
  pkg['name'] = name;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  for (const rel of [
    'soundor.config.ts',
    'index.html',
    join('src', 'App.tsx'),
  ]) {
    const p = join(dir, rel);
    await writeFile(p, tokenReplace(await readFile(p, 'utf-8'), name, runtime));
  }
}
