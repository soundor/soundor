import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const temporary = await mkdtemp(resolve(tmpdir(), 'soundor-consumer-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`,
    );
  return result.stdout;
}
try {
  const packages = [
    'core',
    'config',
    'test-runtime',
    'react',
    'vitest',
    'vitest-environment-soundor',
  ];
  const tarballs = {};
  for (const folder of packages) {
    const path = resolve(repository, 'packages', folder);
    const manifest = JSON.parse(
      await readFile(resolve(path, 'package.json'), 'utf8'),
    );
    run('pnpm', ['pack', '--pack-destination', temporary], path);
    tarballs[manifest.name] =
      `file:${resolve(temporary, `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`)}`;
  }
  await writeFile(
    resolve(temporary, 'package.json'),
    JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: {
          '@soundor/react': tarballs['@soundor/react'],
          react: '19.3.0',
        },
        devDependencies: {
          vitest: '5.0.3',
          '@soundor/vitest': tarballs['@soundor/vitest'],
          'vitest-environment-soundor': tarballs['vitest-environment-soundor'],
          typescript: '7.0.2',
          '@types/node': '24.19.1',
          '@types/react': '19.2.17',
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    resolve(temporary, 'pnpm-workspace.yaml'),
    JSON.stringify({
      autoInstallPeers: true,
      strictPeerDependencies: true,
      nodeLinker: 'isolated',
      storeDir: dirname(run('pnpm', ['store', 'path'], repository).trim()),
      packageImportMethod: 'copy',
      overrides: { ...tarballs, vite: '8.3.2' },
    }),
  );
  run('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], temporary);
  await writeFile(
    resolve(temporary, 'vitest.config.ts'),
    `import {defineConfig} from 'vitest/config';\nimport {soundor} from '@soundor/vitest';\nexport default defineConfig({plugins: [soundor({config: false})], test: {environment: 'soundor'}});\n`,
  );
  await writeFile(
    resolve(temporary, 'component.test.tsx'),
    `import {expect, test} from 'vitest';\nimport {createRoot, flushSync, Pressable, Text, useAnimationFrame} from '@soundor/react';\nimport {root} from 'soundor:ui';\nimport {getTestRuntime} from '@soundor/vitest';\nfor (const index of [1,2]) test('packed renderer '+index, () => {\n let presses = 0;const times: number[] = [];const renderer = createRoot();\n function App(){useAnimationFrame(time => times.push(time));return <Pressable accessibilityLabel="Action" onPress={() => presses++}><Text>Go</Text></Pressable>;}\n flushSync(() => renderer.render(<App/>));\n const runtime = getTestRuntime();\n expect(root).toBe(runtime.root);const button = runtime.root.children[0]!;\n runtime.pointerDown(button);runtime.pointerUp(button);\n expect(presses).toBe(1);runtime.advanceTime(34);expect(times).toHaveLength(2);\n flushSync(() => renderer.unmount());expect(runtime.clock.pending).toBe(0);\n});\n`,
  );
  console.log(run('pnpm', ['exec', 'vitest', 'run'], temporary));
  await writeFile(
    resolve(temporary, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        lib: ['ES2023'],
        types: ['node'],
      },
      include: ['*.ts', '*.tsx', '.soundor/generated/*.d.ts'],
    }),
  );
  console.log(run('pnpm', ['exec', 'tsc'], temporary));
  console.log(
    'Packed consumer: strict pnpm install, runtime tests, and TypeScript passed.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
