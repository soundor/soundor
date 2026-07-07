import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { outro, spinner } from '@clack/prompts';
import { parseConfig, resolveRuntime, runPhase } from '@soundor/config';
import {
  checkGeneratedFiles,
  createCodegenSink,
  createConsoleLogger,
  createNodeFileSystem,
  createProjectPaths,
  generateSoundorFiles,
  rootFromConfigPath,
  writeGeneratedFiles,
} from '@soundor/core';
import { defineCommand } from 'citty';

const CONFIG_FILENAME = 'soundor.config.ts';

export interface RunGenOptions {
  cwd?: string;
  configPath?: string;
  check?: boolean;
}

export async function runGen(options: RunGenOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd, options.configPath);
  const root = rootFromConfigPath(configPath);
  const config = await parseConfig({ path: configPath });
  const fs = createNodeFileSystem(root);
  const logger = createConsoleLogger('soundor');
  const portableDir = fs.resolve('.soundor', 'generated');
  const portableFiles = generateSoundorFiles(config);

  if (options.check === true) {
    await checkGeneratedFiles(fs, portableDir, portableFiles);
  } else {
    await writeGeneratedFiles(fs, portableDir, portableFiles);
  }

  for (const runtimeEntry of config.runtimes) {
    const resolved = resolveRuntime(config, runtimeEntry.id);
    const codegen = createCodegenSink();
    const paths = createProjectPaths({
      root,
      config: configPath,
      runtimeId: runtimeEntry.id,
    });

    await runPhase(resolved, 'gen', config, {
      paths,
      fs,
      logger: logger.child(runtimeEntry.id),
      codegen,
    });

    if (options.check === true) {
      await checkGeneratedFiles(fs, paths.gen, codegen.files());
    } else {
      await writeGeneratedFiles(fs, paths.gen, codegen.files());
    }
  }
}

export const genCommand = defineCommand({
  meta: {
    name: 'gen',
    description: 'Generate derived files from configuration',
  },
  args: {
    check: {
      type: 'boolean',
      description: 'Assert generated files are up to date without writing',
    },
    config: {
      type: 'string',
      description: 'Path to soundor.config.ts',
    },
  },
  async run({ args }) {
    const s = spinner();
    const check = args['check'] === true;
    s.start(check ? 'Checking generated files' : 'Generating files');
    await runGen({
      configPath:
        typeof args['config'] === 'string' ? args['config'] : undefined,
      check,
    });
    s.stop(check ? 'Generated files are up to date' : 'Files generated');
    outro('Done');
  },
});

function resolveConfigPath(cwd: string, configPath?: string): string {
  if (configPath === undefined) return locateConfig(cwd);
  return isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
}

function locateConfig(cwd: string): string {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = resolve(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not find ${CONFIG_FILENAME} in ${resolve(cwd)} or any parent directory.`,
  );
}
