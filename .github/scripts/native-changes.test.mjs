import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./native-changes.mjs', import.meta.url));
test('native input detection covers engine, adapters and shared build inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'soundor-inputs-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('commit', '--allow-empty', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    for (const [path, native, juce] of [
      ['docs/guide.md', false, false],
      ['packages/react/src/index.ts', false, false],
      ['runtimes/web-runtime/src/client/index.ts', false, false],
      ['runtimes/engine/cmake/SoundorDependencies.cmake', true, true],
      ['packages/core/src/native-module.ts', true, true],
      ['runtimes/juce-runtime/src/native-codegen.ts', true, true],
      ['runtimes/juce-runtime/native/backend/juce/Adapter.cpp', false, true],
      ['runtimes/juce-runtime/src/codegen.ts', false, true],
      ['pnpm-lock.yaml', true, true],
      ['.github/workflows/verify.yml', true, true],
      ['.clang-tidy', true, true],
      ['.nvmrc', true, true],
      ['.npmrc', true, true],
      ['runtimes/engine/README.md', false, false],
      ['runtimes/engine/CHANGELOG.md', false, false],
      ['runtimes/engine/src/a11y/apple/README.md', false, false],
      ['runtimes/juce-runtime/README.md', false, false],
      ['examples/basic/README.md', false, false],
      ['.github/pull_request_template.md', false, false],
      ['runtimes/engine/NOTICE.md', true, true],
      ['runtimes/engine/licenses/accesskit/crates-linux-x64.md', true, true],
    ]) {
      git('reset', '--hard', base);
      git('clean', '-fdq');
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), 'fixture');
      git('add', '.');
      git('commit', '-qm', path);
      const output = join(root, 'output');
      execFileSync(process.execPath, [script], {
        cwd: root,
        env: {
          ...process.env,
          BASE_SHA: base,
          HEAD_SHA: git('rev-parse', 'HEAD'),
          GITHUB_OUTPUT: output,
        },
      });
      assert.equal(
        readFileSync(output, 'utf8'),
        `native=${native}\njuce=${juce}\n`,
        path,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
