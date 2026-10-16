// Which native jobs a change needs: those whose package `turbo query affected`
// reports, from a change to the package, a workspace package it depends on,
// its external dependencies or turbo's global dependencies. CI's own
// definition is not in the package graph, so a change to it runs everything,
// as does an unknown base.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

// The packages each job builds. An example counts only for its own files: it
// depends on every package its plugin uses, which the job is not about.
const JOBS = {
  native: { '@soundor/engine': 'any', 'soundor-benchmark': 'own' },
  juce: { '@soundor/juce-runtime': 'any', basic: 'own' },
};
const CI =
  /^\.github\/(workflows\/verify\.yml|actions\/|scripts\/native-changes)/;

const base = process.env.BASE_SHA;
const head = process.env.HEAD_SHA;

function ciChanged() {
  return execFileSync('git', ['diff', '--name-only', base, head], {
    encoding: 'utf8',
  })
    .split('\n')
    .some((path) => CI.test(path));
}

function affectedPackages() {
  const args = [
    'query',
    'affected',
    '--packages',
    ...Object.values(JOBS).flatMap(Object.keys),
    '--base',
    base,
    '--head',
    head,
  ];
  const output = process.env.TURBO_BIN
    ? execFileSync(process.env.TURBO_BIN, args, { encoding: 'utf8' })
    : execFileSync('npx', ['--yes', `turbo@${lockedTurbo()}`, ...args], {
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });
  return JSON.parse(output).data.affectedPackages.items;
}

// The detection job does not install the workspace: it runs the locked turbo.
function lockedTurbo() {
  const version = /^ {2}turbo@(\d+\.\d+\.\d+):/m.exec(
    readFileSync('pnpm-lock.yaml', 'utf8'),
  )?.[1];
  if (version === undefined) throw new Error('pnpm-lock.yaml locks no turbo');
  return version;
}

const affected =
  !base || /^0+$/.test(base) || ciChanged() ? null : affectedPackages();
appendFileSync(
  process.env.GITHUB_OUTPUT,
  Object.entries(JOBS)
    .map(([job, packages]) => {
      const run =
        affected === null ||
        affected.some(
          ({ name, reason }) =>
            packages[name] === 'any' ||
            (packages[name] === 'own' && reason.__typename === 'FileChanged'),
        );
      return `${job}=${run}\n`;
    })
    .join(''),
);
