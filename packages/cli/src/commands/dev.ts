import { outro, spinner } from '@clack/prompts';
import { defineCommand } from 'citty';

export const devCommand = defineCommand({
  meta: {
    name: 'dev',
    description: 'Run development workflow for a runtime',
  },
  args: {
    runtime: {
      type: 'positional',
      description: 'Runtime to use (e.g. juce)',
      required: true,
    },
  },
  async run({ args }) {
    const s = spinner();
    s.start(`Starting dev mode for runtime: ${args['runtime']}`);
    s.stop('Dev mode ready');
    outro('Done');
  },
});
