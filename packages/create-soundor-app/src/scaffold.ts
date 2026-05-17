import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function tokenReplace(
  content: string,
  name: string,
  runtime: string,
): string {
  return content
    .replaceAll('__PROJECT_NAME__', name)
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
