import convert from 'npm-to-yarn';

/**
 * Install commands as tabs for the package managers Soundor supports, pnpm
 * first: Fumadocs' `remarkNpm` turns an npm command block into them.
 */
export const packageManagers = (['pnpm', 'npm'] as const).map((name) => ({
  name,
  command: (command: string) =>
    command
      .split('\n')
      .map((line) => convert(line, name))
      .join('\n'),
}));
