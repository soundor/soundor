export type PackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun';

export const PM_EXEC: Record<PackageManager, string[]> = {
  pnpm: ['pnpm', 'exec'],
  yarn: ['yarn', 'exec'],
  npm: ['npx'],
  bun: ['bunx'],
};

export function detectPackageManager(): PackageManager | undefined {
  const agent = process.env['npm_config_user_agent'];
  if (!agent) return undefined;
  if (agent.startsWith('pnpm')) return 'pnpm';
  if (agent.startsWith('yarn')) return 'yarn';
  if (agent.startsWith('npm')) return 'npm';
  if (agent.startsWith('bun')) return 'bun';
  return undefined;
}
