import { exitCodeFor } from '@soundor/core';
import { defineCommand, renderUsage, runCommand } from 'citty';

import { buildCommand } from './commands/build';
import { devCommand } from './commands/dev';
import { doctorCommand } from './commands/doctor';
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
    process.exitCode = exitCodeFor(error);
  }
}

async function showHelp(rawArgs: string[]): Promise<void> {
  const commandName = rawArgs.find((arg) => !arg.startsWith('-'));
  const command =
    commandName === undefined
      ? undefined
      : main.subCommands?.[
          commandName as keyof NonNullable<typeof main.subCommands>
        ];
  console.log(
    command === undefined
      ? await renderUsage(main)
      : await renderUsage(command, main),
  );
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
