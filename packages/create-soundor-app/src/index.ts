import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cancel,
  intro,
  isCancel,
  outro,
  select,
  spinner,
  text,
} from '@clack/prompts';
import { defineCommand, runMain } from 'citty';

import { type PackageManager, PM_EXEC, detectPackageManager } from './pm';
import { applyTokens } from './scaffold';

const RUNTIMES = ['juce'] as const;

const main = defineCommand({
  meta: {
    name: 'create-soundor-app',
    description: 'Create a new Soundor app',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Project name',
      required: false,
    },
  },
  async run({ args }) {
    intro('create-soundor-app');

    // --- Project name ---
    let projectName = args['name'];
    if (!projectName) {
      const answer = await text({ message: 'Project name' });
      if (isCancel(answer)) {
        cancel('Cancelled');
        process.exit(1);
      }
      projectName = answer;
    }

    if (existsSync(projectName)) {
      cancel(`Directory "${projectName}" already exists`);
      process.exit(1);
    }

    // --- Runtime ---
    const runtime = await select({
      message: 'Runtime',
      options: RUNTIMES.map((r) => ({ value: r, label: r })),
    });
    if (isCancel(runtime)) {
      cancel('Cancelled');
      process.exit(1);
    }

    // --- Package manager ---
    let pm = detectPackageManager();
    if (!pm) {
      const answer = await select<PackageManager>({
        message: 'Package manager',
        options: [
          { value: 'pnpm', label: 'pnpm' },
          { value: 'yarn', label: 'yarn' },
          { value: 'npm', label: 'npm' },
          { value: 'bun', label: 'bun' },
        ],
      });
      if (isCancel(answer)) {
        cancel('Cancelled');
        process.exit(1);
      }
      pm = answer;
    }

    // --- Scaffold ---
    const s = spinner();
    s.start('Scaffolding project');
    const templateDir = fileURLToPath(
      new URL('../templates/base', import.meta.url),
    );
    await cp(templateDir, projectName, { recursive: true });
    await rename(
      join(projectName, '_gitignore'),
      join(projectName, '.gitignore'),
    );
    await applyTokens(projectName, projectName, runtime);
    s.stop('Project scaffolded');

    // --- Install ---
    s.start('Installing dependencies');
    const installResult = spawnSync(pm, ['install'], {
      cwd: projectName,
      stdio: 'inherit',
      shell: false,
    });
    if (installResult.status !== 0) {
      cancel('Dependency installation failed');
      process.exit(1);
    }
    s.stop('Dependencies installed');

    // --- soundor init ---
    s.start(`Running soundor init ${runtime}`);
    const execArgs = [...PM_EXEC[pm], 'soundor', 'init', runtime];
    const initResult = spawnSync(execArgs[0]!, execArgs.slice(1), {
      cwd: projectName,
      stdio: 'inherit',
      shell: false,
    });
    if (initResult.status !== 0) {
      cancel('soundor init failed');
      process.exit(1);
    }
    s.stop('Runtime initialized');

    // --- Done ---
    outro(`Done! Next steps:\n\n  cd ${projectName}\n  ${pm} dev`);
  },
});

runMain(main);
