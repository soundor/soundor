import { outro, spinner } from '@clack/prompts';
import { defineCommand } from 'citty';

export const genCommand = defineCommand({
  meta: {
    name: 'gen',
    description: 'Generate derived files from configuration',
  },
  async run() {
    const s = spinner();
    s.start('Generating files');
    s.stop('Files generated');
    outro('Done');
  },
});
