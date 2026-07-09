import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cancel,
  confirm,
  intro,
  isCancel,
  outro,
  select,
  spinner,
  text,
} from '@clack/prompts';
import { defineCommand, runMain } from 'citty';

import { type PackageManager, PM_EXEC, detectPackageManager } from './pm';
import { applyTokens, clearDirectory, resolveProjectTarget } from './scaffold';

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

    const target = resolveProjectTarget(projectName, process.cwd());

    if (target.isCurrentDirectory) {
      const entries = await readdir(target.targetDir);
      if (entries.length > 0) {
        const answer = await confirm({
          message:
            'Current directory is not empty. Remove all files and continue?',
          initialValue: false,
        });
        if (isCancel(answer) || !answer) {
          cancel('Cancelled');
          process.exit(1);
        }
      }
    } else if (existsSync(target.targetDir)) {
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
    if (target.isCurrentDirectory) {
      await clearDirectory(target.targetDir);
    }

    await cp(templateDir, target.targetDir, {
      errorOnExist: true,
      force: false,
      recursive: true,
    });
    await rename(
      join(target.targetDir, '_gitignore'),
      join(target.targetDir, '.gitignore'),
    );
    await applyTokens(target.targetDir, target.packageName, runtime);
    s.stop('Project scaffolded');

    // --- Install ---
    s.start('Installing dependencies');
    const installResult = spawnSync(pm, ['install'], {
      cwd: target.targetDir,
      stdio: 'inherit',
      shell: false,
    });
    if (installResult.status !== 0) {
      cancel('Dependency installation failed');
      process.exit(1);
    }
    s.stop('Dependencies installed');

    // --- soundor init ---
    s.start('Running soundor init');
    const execArgs = [...PM_EXEC[pm], 'soundor', 'init'];
    const initResult = spawnSync(execArgs[0]!, execArgs.slice(1), {
      cwd: target.targetDir,
      stdio: 'inherit',
      shell: false,
    });
    if (initResult.status !== 0) {
      cancel('soundor init failed');
      process.exit(1);
    }
    s.stop('Runtime initialized');

    // --- Done ---
    const nextSteps = target.isCurrentDirectory
      ? `${pm} dev`
      : `cd ${projectName}\n  ${pm} dev`;
    outro(`Done! Next steps:\n\n  ${nextSteps}`);
  },
});

runMain(main);
