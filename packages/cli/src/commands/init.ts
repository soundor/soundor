import { intro, isCancel, outro, spinner, text } from '@clack/prompts';
import { defineCommand } from 'citty';

export const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Create project scaffold',
  },
  args: {
    name: {
      type: 'string',
      description: 'Project name',
    },
  },
  async run({ args }) {
    intro('soundor init');

    let projectName = args['name'];

    if (!projectName) {
      const answer = await text({ message: 'Project name' });
      if (isCancel(answer)) {
        outro('Cancelled');
        process.exit(0);
      }
      projectName = answer;
    }

    const s = spinner();
    s.start('Creating project scaffold');
    s.stop(`Created project: ${projectName}`);

    outro('Done');
  },
});
