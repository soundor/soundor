import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { nativeInputs } from '../../src/inputs.ts';
import { packageRoot } from '../../src/targets.ts';
import { COMMIT, artifact, here, packageCopy, temporary } from './helpers.ts';

test('source CLI prepares and resolves artifacts before any workspace dependency is built', () => {
  const directory = temporary('vst3-host-bootstrap-');
  try {
    const root = packageCopy(join(directory, 'host'));
    cpSync(join(packageRoot, 'src'), join(root, 'src'), { recursive: true });
    cpSync(join(packageRoot, 'targets.json'), join(root, 'targets.json'));
    const manifest = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    );
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ ...manifest, type: 'module' }),
    );
    expect(existsSync(join(root, 'node_modules'))).toBe(false);
    expect(existsSync(join(root, 'dist'))).toBe(false);
    const staged = join(directory, 'artifact');
    const fingerprint = nativeInputs(root).fingerprint;
    artifact(staged, here, { sourceFingerprint: fingerprint });
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [join(root, 'src/cli.ts'), ...args], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          SOUNDOR_VST3_HOST_EXECUTABLE: undefined,
          SOUNDOR_CACHE: join(directory, 'cache'),
          SOUNDOR_VST3_HOST_ARTIFACT: staged,
        },
      });
    const inputs = run('inputs');
    expect(inputs.stderr).toBe('');
    expect(inputs.status).toBe(0);
    expect(JSON.parse(inputs.stdout).fingerprint).toBe(fingerprint);
    const prepared = run('prepare', '--mode', 'published', '--commit', COMMIT);
    expect(prepared.stderr).toBe('');
    expect(prepared.status).toBe(0);
    const resolved = run('resolve');
    expect(resolved.stderr).toBe('');
    expect(resolved.status).toBe(0);
    expect(resolved.stdout).toContain(join(staged, here.executable));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
