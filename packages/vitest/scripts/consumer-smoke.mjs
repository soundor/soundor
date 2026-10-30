import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const temporary = await mkdtemp(resolve(tmpdir(), 'soundor-consumer-'));
const vanilla = await mkdtemp(resolve(tmpdir(), 'soundor-vanilla-consumer-'));
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
    'runtimes/engine',
    'packages/core',
    'packages/environment',
    'packages/config',
    'packages/test-runtime',
    'packages/react',
    'packages/testing-library',
    'packages/vitest',
    'packages/vitest-environment-soundor',
  ];
  const tarballs = {};
  for (const folder of packages) {
    const path = resolve(repository, folder);
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
          '@soundor/testing-library': tarballs['@soundor/testing-library'],
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
    `import {defineConfig} from 'vitest/config';\nimport {soundor} from '@soundor/vitest';\nexport default defineConfig({plugins: [soundor({config: false, runtime: {parameters: [{id: 'gain', label: 'Gain', type: 'float', min: 0, max: 1, default: 0.5}]}, native: {methods: {probe: {returns: 'number'}, loadPreset: {returns: 'string', async: true}}}})], test: {environment: 'soundor'}});\n`,
  );
  await writeFile(
    resolve(temporary, 'component.test.tsx'),
    `import {expect, test, vi} from 'vitest';
import {Pressable, Text, TextInput, useAnimationFrame} from '@soundor/react';
import {useState} from 'react';
import {render, screen, userEvent, advanceTime, testParameters, testHost, mockNative} from '@soundor/testing-library/react';
import {parameters} from 'soundor:parameters';
import {snapshot} from 'soundor:host';
import {probe, loadPreset} from 'soundor:native';
for (const index of [1,2]) test('packed testing library '+index, async () => {
 expect(parameters.gain.get()).toBe(0.5);expect(snapshot().hostName).toBe('Soundor Test');
 expect(() => probe()).toThrow('requires a configured test mock');
 testParameters.set('gain', 0.75);testHost.set({hostName: 'Packed DAW'});
 expect(parameters.gain.get()).toBe(0.75);expect(snapshot().hostName).toBe('Packed DAW');
 mockNative('probe', vi.fn(() => 42));mockNative('loadPreset', vi.fn(async () => 'Warm'));
 expect(probe()).toBe(42);expect(await loadPreset()).toBe('Warm');
 const onChange = vi.fn();const times: number[] = [];
 function App(){const [count,setCount] = useState(0);useAnimationFrame(time => times.push(time));return <>
 <TextInput accessibilityLabel="Name" />
 <Pressable accessibilityLabel="Increment" onPress={() => {setCount(count+1);onChange(count+1);}}><Text>Go</Text></Pressable>
 <Text>Count: {count}</Text></>;}
 await render(<App/>);const user = userEvent.setup();
 await user.type(screen.getByRole('textinput', {name: 'Name'}), 'Soundor');
 expect(screen.getByRole('textinput', {name: 'Name'})).toHaveFocus();
 await user.tab();expect(screen.getByRole('button', {name: 'Increment'})).toHaveFocus();
 expect(screen.getByRole('textinput', {name: 'Name'})).not.toHaveFocus();
 await user.keyboard('{Enter}');
 expect(onChange).toHaveBeenCalledWith(1);expect(screen.getByText('Count: 1')).toBeDefined();
 await user.click(screen.getByRole('button', {name: 'Increment'}));
 expect(screen.getByText('Count: 2')).toBeDefined();
 await advanceTime(100);expect(times).toHaveLength(6);
});
`,
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
  // Verify matcher signatures independently of the project's generated globals.
  await writeFile(
    resolve(temporary, 'matcher-types.ts'),
    `
import type {} from '@soundor/vitest';
import {expect} from 'vitest';
declare const node: unknown;
const result: void = expect(node).toHaveFocus();
const negated: void = expect(node).not.toHaveFocus();
const promised: Promise<void> = expect(Promise.resolve(node)).resolves.toHaveFocus();
// @ts-expect-error focus matcher takes no arguments
expect(node).toHaveFocus('unexpected');
`,
  );
  const matcherConfig = JSON.parse(
    await readFile(resolve(temporary, 'tsconfig.json'), 'utf8'),
  );
  matcherConfig.include = ['matcher-types.ts'];
  await writeFile(
    resolve(temporary, 'tsconfig.matchers.json'),
    JSON.stringify(matcherConfig),
  );
  console.log(
    run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.matchers.json'], temporary),
  );
  // Disable automatic peer installation to prove optional React peers are not needed.
  // Vite is explicit here because both Vitest and the plugin require that peer.
  await writeFile(
    resolve(vanilla, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      devDependencies: {
        vitest: '5.0.3',
        vite: '8.3.2',
        typescript: '7.0.2',
        '@types/node': '24.19.1',
        '@soundor/vitest': tarballs['@soundor/vitest'],
        'vitest-environment-soundor': tarballs['vitest-environment-soundor'],
        '@soundor/testing-library': tarballs['@soundor/testing-library'],
      },
    }),
  );
  await writeFile(
    resolve(vanilla, 'pnpm-workspace.yaml'),
    JSON.stringify({
      ...JSON.parse(
        await readFile(resolve(temporary, 'pnpm-workspace.yaml'), 'utf8'),
      ),
      autoInstallPeers: false,
      overrides: Object.fromEntries(
        Object.entries(tarballs)
          .filter(([name]) => name !== '@soundor/react')
          .concat([['vite', '8.3.2']]),
      ),
    }),
  );
  run('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], vanilla);
  await writeFile(
    resolve(vanilla, 'vitest.config.ts'),
    await readFile(resolve(temporary, 'vitest.config.ts')),
  );
  await writeFile(
    resolve(vanilla, 'vanilla.test.ts'),
    `import {expect, test} from 'vitest';
import {createRequire} from 'node:module';
import {createTextInput, root} from 'soundor:ui';
import {screen, userEvent} from '@soundor/testing-library';
test('framework independent packed utilities', async () => {
 const require = createRequire(import.meta.url);
 expect(() => require.resolve('react', {paths: [process.cwd()]})).toThrow('Cannot find module');
 const node = createTextInput();node.accessibility = {label: 'Name'};root.appendChild(node);
 await userEvent.setup().type(screen.getByRole('textinput', {name: 'Name'}), 'vanilla');
 expect(node.value).toBe('vanilla');expect(node).toHaveFocus();
});
`,
  );
  console.log(run('pnpm', ['exec', 'vitest', 'run'], vanilla));
  await writeFile(
    resolve(vanilla, 'tsconfig.json'),
    await readFile(resolve(temporary, 'tsconfig.json')),
  );
  console.log(run('pnpm', ['exec', 'tsc'], vanilla));
  console.log(
    'Packed consumer: strict pnpm installs, React and vanilla interactions, and TypeScript passed.',
  );
} finally {
  await Promise.all(
    [temporary, vanilla].map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
}
