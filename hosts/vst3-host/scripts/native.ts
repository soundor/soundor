// node scripts/native.ts test [--preset dev|release|sanitize]
//
// Builds the executable, the self-test and the fixture plugins with a CMake
// workflow preset, then runs the Node integration tests (tests/native)
// against them. On Linux without a display, the editor tests run under
// xvfb-run when it is installed, and are skipped otherwise.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { packageRoot } from '../src/targets.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { preset: { type: 'string', default: 'dev' } },
});
if (positionals[0] !== 'test') {
  console.error(
    'usage: node scripts/native.ts test [--preset dev|release|sanitize]',
  );
  process.exit(64);
}
const preset = values.preset!;

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('cmake', ['--workflow', '--preset', preset]);

const build = join(packageRoot, 'build', preset);
const env = {
  ...process.env,
  SOUNDOR_VST3_HOST_EXECUTABLE: join(
    build,
    'bin',
    process.platform === 'win32'
      ? 'soundor-vst3-host.exe'
      : 'soundor-vst3-host',
  ),
  SOUNDOR_VST3_HOST_FIXTURES: join(build, 'fixtures'),
};
const vitest = ['exec', 'vitest', 'run', '--config', 'vitest.native.config.ts'];
const xvfb =
  process.platform === 'linux' &&
  !process.env.DISPLAY &&
  spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' }).status === 0;
if (xvfb)
  run(
    'xvfb-run',
    ['-a', '-s', '-screen 0 1280x1024x24', 'pnpm', ...vitest],
    env,
  );
else run('pnpm', vitest, env);
