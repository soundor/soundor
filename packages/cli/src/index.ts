import { defineCommand, runMain } from 'citty';

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

runMain(main);
