import { stripVTControlCharacters } from 'node:util';

import { exitCodeFor } from '@soundor/core';
import {
  defineCommand,
  renderUsage,
  runCommand,
  type CommandDef,
  type Resolvable,
} from 'citty';

import { buildCommand } from './commands/build';
import { devCommand } from './commands/dev';
import { doctorCommand } from './commands/doctor';
import { driverCommand } from './commands/driver';
import { genCommand } from './commands/gen';
import { initCommand } from './commands/init';

const main = defineCommand({
  meta: {
    name: 'soundor',
    description: 'The Soundor CLI',
  },
  subCommands: {
    init: initCommand,
    gen: genCommand,
    dev: devCommand,
    build: buildCommand,
    doctor: doctorCommand,
    driver: driverCommand,
  },
});

await runCli(process.argv.slice(2));

async function runCli(rawArgs: string[]): Promise<void> {
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    await showHelp(rawArgs);
    return;
  }

  try {
    await runCommand(main, { rawArgs });
  } catch (error) {
    console.error(formatError(error));
    // citty's own errors are about the arguments: an unknown command, a
    // missing argument.
    process.exitCode =
      error instanceof Error && error.name === 'CLIError'
        ? 2
        : exitCodeFor(error);
  }
}

/** Usage of the command the arguments name: `soundor driver tree --help`. */
async function showHelp(rawArgs: string[]): Promise<void> {
  let command: CommandDef = main;
  let parent: CommandDef | undefined;
  let path = 'soundor';
  for (const name of rawArgs.filter((arg) => !arg.startsWith('-'))) {
    const subCommands = await resolveValue(command.subCommands);
    const next = subCommands?.[name];
    if (next === undefined) break;
    parent = { meta: { name: path } };
    path += ` ${name}`;
    command = await resolveValue(next);
  }
  const usage = await renderUsage(command, parent);
  // Plain text for scripts and agents.
  console.log(process.stdout.isTTY ? usage : stripVTControlCharacters(usage));
}

async function resolveValue<T>(value: Resolvable<T>): Promise<T> {
  return typeof value === 'function'
    ? await (value as () => T | Promise<T>)()
    : await value;
}

function formatError(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'format' in error &&
    typeof error.format === 'function'
  ) {
    return String(error.format());
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
