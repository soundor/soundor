/**
 * The package managers a new project can use: pnpm and npm, the ones whose
 * installs are known to work (a flat or symlinked node_modules the native
 * build can find packages in). Yarn's Plug'n'Play and bun are not supported.
 */
export type PackageManager = 'pnpm' | 'npm';

export const PACKAGE_MANAGERS: readonly PackageManager[] = ['pnpm', 'npm'];

export const PM_EXEC: Record<PackageManager, string[]> = {
  pnpm: ['pnpm', 'exec'],
  npm: ['npx'],
};

/** How to run a package.json script: npm needs `run` for most names. */
export function runScript(pm: PackageManager, script: string): string {
  return pm === 'npm' ? `npm run ${script}` : `pnpm ${script}`;
}

/**
 * The package manager this was started with (`pnpm create`, `npm create`,
 * `npx`), or undefined: none, or one Soundor does not support.
 */
export function detectPackageManager(): PackageManager | undefined {
  const agent = process.env['npm_config_user_agent'];
  if (!agent) return undefined;
  if (agent.startsWith('pnpm/')) return 'pnpm';
  if (agent.startsWith('npm/')) return 'npm';
  return undefined;
}
