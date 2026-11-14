#!/usr/bin/env node
// Configure the existing npm packages for .github/workflows/release.yml.
// Preview by default; --apply runs npm's authenticated trust commands.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const environment = 'npm-production';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: pnpm npm:trust [--apply] [package ...]');
  console.log('Without --apply, prints commands without contacting npm.');
  process.exit(0);
}
const apply = args.includes('--apply');
const requested = args.filter((arg) => arg !== '--apply');
if (requested.some((arg) => arg.startsWith('-'))) {
  console.error(
    'Unknown option. Usage: pnpm npm:trust [--apply] [package ...]',
  );
  process.exit(1);
}

function run(command, commandArgs, capture = false) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  return result;
}

const workspaceResult = run(
  'pnpm',
  ['-r', 'list', '--depth', '-1', '--json'],
  true,
);
if (workspaceResult.status !== 0) process.exit(1);
const workspace = JSON.parse(workspaceResult.stdout);
const { targets } = JSON.parse(
  readFileSync(
    new URL('../hosts/vst3-host/targets.json', import.meta.url),
    'utf8',
  ),
);
const packages = [
  ...new Set([
    ...workspace.filter((pkg) => !pkg.private).map((pkg) => pkg.name),
    ...targets.map((target) => target.package),
  ]),
].sort();
const unknown = requested.filter((name) => !packages.includes(name));
if (unknown.length) {
  console.error(`Unknown or private packages: ${unknown.join(', ')}`);
  process.exit(1);
}
const selected = requested.length
  ? packages.filter((name) => requested.includes(name))
  : packages;

if (apply) {
  const version = run('npm', ['--version'], true);
  const [major, minor] = version.stdout.trim().split('.').map(Number);
  if (version.status !== 0 || !(major > 11 || (major === 11 && minor >= 15))) {
    console.error('npm trust requires npm >=11.15.0.');
    process.exit(1);
  }
}

console.log(
  `${apply ? 'Configuring' : 'Previewing'} ${selected.length} packages for soundor/soundor, release.yml, ${environment}`,
);
const failed = [];
for (const [index, name] of selected.entries()) {
  const command = [
    'trust',
    'github',
    name,
    '--repo',
    'soundor/soundor',
    '--file',
    'release.yml',
    '--environment',
    environment,
    '--allow-publish',
    '--yes',
    '--registry',
    'https://registry.npmjs.org',
  ];
  console.log(`npm ${command.join(' ')}`);
  if (!apply) continue;
  if (index > 0) await setTimeout(2000);
  const existing = run(
    'npm',
    [
      'trust',
      'list',
      name,
      '--json',
      '--registry',
      'https://registry.npmjs.org',
    ],
    true,
  );
  if (existing.status !== 0) {
    console.error(`${name}: could not inspect publishers; leaving unchanged.`);
    failed.push(name);
    continue;
  }
  let publishers;
  try {
    // npm prints each publisher as a JSON object separated by blank lines.
    // With no publishers it prints nothing in --json mode.
    publishers = existing.stdout.trim()
      ? existing.stdout
          .trim()
          .split(/\n\s*\n/)
          .flatMap((item) => JSON.parse(item))
      : [];
    if (
      publishers.some(
        (publisher) => !publisher || typeof publisher !== 'object',
      )
    ) {
      throw new Error('Expected publisher objects');
    }
  } catch {
    console.error(
      `${name}: unrecognized publisher response; leaving unchanged.`,
    );
    failed.push(name);
    continue;
  }
  const matching = publishers.some(
    (publisher) =>
      publisher.type === 'github' &&
      publisher.repository === 'soundor/soundor' &&
      publisher.file === 'release.yml' &&
      publisher.environment === environment &&
      publisher.permissions?.includes('createPackage'),
  );
  if (matching) {
    console.log(`${name}: already configured; skipped.`);
    continue;
  }
  if (publishers.length) {
    console.error(
      `${name}: conflicting publisher; inspect with npm trust list ${name}. Leaving unchanged.`,
    );
    failed.push(name);
    continue;
  }
  // Space the read and write requests too, as npm recommends for bulk use.
  await setTimeout(2000);
  if (run('npm', command).status !== 0) failed.push(name);
}
if (failed.length) {
  console.error(
    `Failed packages (existing publishers are never revoked): ${failed.join(', ')}`,
  );
  process.exitCode = 1;
} else if (!apply) {
  console.log('Preview only. Run pnpm npm:trust --apply to configure npm.');
}
