// Content identity shared by local selection, CMake staging and CI. This has
// no build step and no dependency on Git, so dirty trees and npm installs work.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
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

/**
 * The identity of the WebAssembly core (wasm/, `soundor-core.wasm`): what
 * reaches the module, and nothing native-only, so that a native change keeps
 * the published module and a web change keeps the native archives. Needs a
 * source checkout (wasm/ is not in the npm package).
 *
 *   - wasm/ (its sources, its CMake, the pinned Emscripten: emscripten.json)
 *   - the translation units the module compiles (SoundorCoreSources.cmake,
 *     the src/ files wasm/CMakeLists.txt adds) and every header they reach
 *     by #include, as text (a superset of what the preprocessor reads)
 *   - the CMake a wasm configure reads: the top CMakeLists.txt up to its
 *     Emscripten return(), the modules it and SoundorYoga include (Yoga's
 *     pin and patch), and the wasm preset
 *   - the engine version (the ABI namespace, SoundorAbi.h.in)
 */
export function webInputs(root) {
  root = resolve(root);
  const read = (path) => readFileSync(join(root, path), 'utf8');
  if (!existsSync(join(root, 'wasm/CMakeLists.txt')))
    throw new Error(
      `${root} is not an engine source checkout: the WebAssembly core's inputs are not in the npm package`,
    );
  const wasmFiles = [];
  for (const entry of readdirSync(join(root, 'wasm'), { withFileTypes: true }))
    if (entry.isFile() && !/\.md$/.test(entry.name))
      wasmFiles.push(`wasm/${entry.name}`);
    else if (!entry.isFile())
      throw new Error(
        `wasm/${entry.name} is not a file: list it in webInputs()`,
      );

  const units = new Set(wasmFiles.filter((path) => path.endsWith('.cpp')));
  for (const list of ['cmake/SoundorCoreSources.cmake', 'wasm/CMakeLists.txt'])
    for (const match of read(list)
      .replaceAll(/#.*$/gm, '') // comments name sources that are not compiled
      .matchAll(/\bsrc\/[\w/.-]+\.cpp\b/g))
      units.add(match[0]);
  // #include closure, resolved as the wasm target's include directories do.
  const searched = ['include', 'src'];
  const reached = new Set();
  const visit = (path) => {
    if (reached.has(path)) return;
    if (!existsSync(join(root, path)))
      throw new Error(
        `The WebAssembly core compiles ${path}, which is missing`,
      );
    reached.add(path);
    for (const line of read(path).split('\n')) {
      const directive = /^\s*#\s*include\s*(.*)$/.exec(line);
      if (!directive) continue;
      const target = /^["<]([^">]+)[">]/.exec(directive[1]);
      if (!target)
        throw new Error(
          `${path}: a computed #include (${line.trim()}) cannot be fingerprinted`,
        );
      const candidates = [
        ...(directive[1].startsWith('"')
          ? [join(dirname(path), target[1])]
          : []),
        ...searched.map((directory) => join(directory, target[1])),
      ];
      const found = candidates.find((candidate) =>
        existsSync(join(root, candidate)),
      );
      // System, Yoga's and generated headers (soundor/Abi.h, from
      // SoundorAbi.h.in) are covered by what produces them.
      if (found) visit(relative(root, join(root, found)).split(sep).join('/'));
    }
  };
  for (const unit of [...units].sort()) visit(unit);

  const top = read('CMakeLists.txt').replaceAll('\r\n', '\n');
  const end =
    /if\(EMSCRIPTEN\)\n\s*add_subdirectory\(wasm\)\n\s*return\(\)\n/.exec(top);
  if (!end)
    throw new Error(
      'CMakeLists.txt no longer returns after add_subdirectory(wasm) for Emscripten: update webInputs()',
    );
  const presets = JSON.parse(read('CMakePresets.json'));
  const preset = (name) => {
    const found = presets.configurePresets.find((p) => p.name === name);
    if (!found) throw new Error(`CMakePresets.json has no ${name} preset`);
    return [found, ...[found.inherits ?? []].flat().flatMap(preset)];
  };

  const files = [
    ...new Set([
      ...wasmFiles,
      ...reached,
      'cmake/SoundorAbi.cmake',
      'cmake/SoundorAbi.h.in',
      'cmake/SoundorPluginShim.cmake',
      'cmake/SoundorCompilerOptions.cmake',
      'cmake/SoundorCoreSources.cmake',
      'cmake/SoundorDependencies.cmake',
      'cmake/SoundorYoga.cmake',
      'cmake/SoundorYogaPatch.cmake',
    ]),
  ].sort();
  const { version } = JSON.parse(read('package.json'));
  const hash = createHash('sha256').update(
    `soundor-engine-web-inputs-v1\0${version}\0`,
  );
  const digest = (content) => createHash('sha256').update(content).digest();
  hash.update('CMakeLists.txt').update('\0');
  hash.update(digest(top.slice(0, end.index + end[0].length))).update('\0');
  hash.update('CMakePresets.json#wasm').update('\0');
  hash.update(digest(JSON.stringify(preset('wasm')))).update('\0');
  for (const path of files) {
    hash.update(path).update('\0');
    hash.update(digest(read(path).replaceAll('\r\n', '\n'))).update('\0');
  }
  return {
    fingerprint: hash.digest('hex'),
    files: [
      join(root, 'CMakeLists.txt'),
      join(root, 'CMakePresets.json'),
      ...files.map((path) => join(root, path)),
    ],
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
    const names = new Set(Object.keys(pkg.dependencies ?? {}));
    // The bundled transform plugins are build dependencies, but their live
    // versions still affect workspace source builds. Other dev tools do not.
    if (key === '@soundor/engine')
      for (const name of Object.keys(pkg.devDependencies ?? {}))
        if (name.startsWith('@babel/')) names.add(name);
    for (const name of [...names].sort()) {
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
  console.log(
    JSON.stringify(
      process.argv[3] === 'web'
        ? webInputs(process.argv[2])
        : engineInputs(process.argv[2]),
    ),
  );
}
