// Which native jobs a change needs: those whose package `turbo query affected`
// reports, from a change to the package, a workspace package it depends on,
// its external dependencies or turbo's global dependencies. CI's own
// definition is not in the package graph, so a change to it runs everything,
// as does an unknown base. A change to the VST3 host alone runs its job only:
// the others' packages reach it just through @soundor/driver's optional
// `vst3` entry, and nothing they build or test uses that.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

// The package each job tests.
const JOBS = {
  native: '@soundor/engine',
  juce: '@soundor/juce-runtime',
  benchmark: 'soundor-benchmark',
  host: '@soundor/vst3-host',
};
const CI =
  /^\.github\/(workflows\/(verify|release|engine-artifacts|engine-prebuilts|vst3-host-artifacts)\.yml|actions\/|scripts\/(native-changes|engine-prebuilts|verify-results))/;

const HOST = 'hosts/vst3-host/';

const base = process.env.BASE_SHA;
const head = process.env.HEAD_SHA;

function changedFiles() {
  return execFileSync('git', ['diff', '--name-only', base, head], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

function affectedPackages() {
  const args = [
    'query',
    'affected',
    '--packages',
    ...Object.values(JOBS),
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
  return new Set(
    JSON.parse(output).data.affectedPackages.items.map((item) => item.name),
  );
}

// The detection job does not install the workspace: it runs the locked turbo.
function lockedTurbo() {
  const version = /^ {2}turbo@(\d+\.\d+\.\d+):/m.exec(
    readFileSync('pnpm-lock.yaml', 'utf8'),
  )?.[1];
  if (version === undefined) throw new Error('pnpm-lock.yaml locks no turbo');
  return version;
}

function affectedByChange() {
  if (!base || /^0+$/.test(base)) return null;
  const files = changedFiles();
  if (files.some((path) => CI.test(path))) return null;
  if (files.length > 0 && files.every((path) => path.startsWith(HOST)))
    return new Set([JOBS.host]);
  return affectedPackages();
}

const affected = affectedByChange();
appendFileSync(
  process.env.GITHUB_OUTPUT,
  Object.entries(JOBS)
    .map(([job, name]) => `${job}=${affected === null || affected.has(name)}\n`)
    .join(''),
);
