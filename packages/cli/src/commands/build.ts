import { outro, spinner } from '@clack/prompts';
import { defineCommand } from 'citty';

export const buildCommand = defineCommand({
  meta: {
    name: 'build',
    description: 'Produce production-ready artifacts',
  },
  args: {
    runtime: {
      type: 'positional',
      description: 'Runtime to build (builds all if omitted)',
      required: false,
    },
  },
  async run({ args }) {
    const target = args['runtime'] ?? 'all runtimes';
    const s = spinner();
    s.start(`Building: ${target}`);
    s.stop(`Built: ${target}`);
    outro('Done');
  },
});
