// Content identity shared by local selection, CMake staging and CI. This has
// no build step and no dependency on Git, so dirty trees and npm installs work.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const textFile = /\.(?:cmake|cpp|c|h|hpp|mm|m|js|mjs|ts|py|in|inc|idl|md|txt)$/;

export function engineInputs(root) {
  root = resolve(root);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(join(root, directory), {
      withFileTypes: true,
    })) {
      if (
        entry.name === '__pycache__' ||
        entry.name.startsWith('.') ||
        /\.(?:pyc|swp|tmp)$/.test(entry.name)
      )
        continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && !/\.test\.[cm]?[jt]s$/.test(path))
        files.push(path);
      else if (entry.isSymbolicLink())
        throw new Error(`Engine input is a symlink: ${path}`);
    }
  };
  for (const directory of ['src', 'include', 'cmake', 'scripts'])
    visit(directory);
  files.push('CMakeLists.txt');
  files.sort();
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const hash = createHash('sha256').update(
    `soundor-engine-inputs-v1\0${manifest.version}\0`,
  );
  for (const path of files) {
    const bytes = readFileSync(join(root, path));
    const content = textFile.test(path)
      ? bytes.toString('utf8').replaceAll('\r\n', '\n')
      : bytes;
    hash.update(path.split(sep).join('/')).update('\0');
    hash.update(createHash('sha256').update(content).digest()).update('\0');
  }

  // Published lowering code bundles its dependencies. Its captured graph is
  // immutable; later installs of Babel (including declaration dependencies)
  // cannot change the code that produced the engine's embedded modules.
  const { dependencies, files: dependencyFiles } = loweringInputs(root);
  for (const [key, edges] of dependencies) {
    hash.update(key).update('\0').update(edges.join('\n')).update('\0');
  }
  return {
    fingerprint: hash.digest('hex'),
    files: [...files.map((path) => join(root, path)), ...dependencyFiles],
  };
}

/** The graph of the lowering tool actually used: bundled in npm, live in a workspace. */
export function loweringInputs(root) {
  const bundled = join(root, 'dist/lowering-inputs.json');
  if (
    !existsSync(join(root, '../../pnpm-workspace.yaml')) &&
    existsSync(bundled)
  )
    return {
      dependencies: JSON.parse(readFileSync(bundled, 'utf8')),
      files: [bundled, join(root, 'dist/native-module.mjs')],
    };
  const dependencies = new Map();
  const dependencyFiles = new Set();
  const inspect = (file, key) => {
    if (dependencies.has(key)) return;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    const require = createRequire(file);
    const edges = [];
    dependencies.set(key, edges);
    dependencyFiles.add(file);
    for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
      // Some dependencies deliberately do not export their package.json.
      const childFile = require.resolve
        .paths(name)
        .map((directory) => join(directory, name, 'package.json'))
        .find(existsSync);
      if (!childFile)
        throw new Error(
          `Engine dependency ${name} is missing; run pnpm install`,
        );
      const resolvedFile = realpathSync(childFile);
      const child = JSON.parse(readFileSync(resolvedFile, 'utf8'));
      const childKey = `${child.name}@${child.version}`;
      edges.push(`${name}=${childKey}`);
      inspect(resolvedFile, childKey);
    }
  };
  inspect(join(root, 'package.json'), '@soundor/engine');
  return {
    dependencies: [...dependencies].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
    files: [...dependencyFiles],
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(JSON.stringify(engineInputs(process.argv[2])));
}
