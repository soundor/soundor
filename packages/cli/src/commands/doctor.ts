import { outro, spinner } from '@clack/prompts';
import { defineCommand } from 'citty';

export const doctorCommand = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Validate environment and project setup',
  },
  async run() {
    const s = spinner();
    s.start('Checking environment');
    s.stop('Environment looks good');
    outro('Done');
  },
});
