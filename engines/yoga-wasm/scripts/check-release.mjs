// What a release has to be sure of about the module:
// - By default: fails when this checkout's module differs from the published one
//   and nothing will publish it. The engine's Yoga is an input, and the engine
//   releases on its own: without this, a patch there would ship in the JUCE
//   runtime and not in the web runtime, and they would no longer lay out alike.
// - With --built: fails unless what was just built, and is about to be packed,
//   was compiled for a release from these inputs. No cache reached it.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { yogaInputs } from './inputs.mjs';
import { latestPackage, publishedModule } from './prepare.mjs';

const PACKAGE = '@soundor/yoga-wasm';
const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repository = resolve(packageRoot, '../..');

/** Whether a changeset's front matter names the package. */
export function namesPackage(changeset) {
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(changeset)?.[1] ?? '';
  return new RegExp(`^['"]?${PACKAGE}['"]?\\s*:`, 'm').test(frontMatter);
}

/** What is wrong with a build that is about to be packed, or null. */
export function builtProblem(build, fingerprint) {
  if (build.source !== 'release')
    return `${PACKAGE}'s build came from ${build.source}: a release builds with SOUNDOR_YOGA_WASM=release.`;
  if (build.fingerprint !== fingerprint)
    return `${PACKAGE}'s build is of other inputs than this checkout's.`;
  return null;
}

/**
 * What is wrong, or null. `published` is what npm has of the package (null: not
 * yet), `sameInputs` whether it was built from these inputs.
 */
export function releaseProblem({ sameInputs, published, version, changeset }) {
  if (sameInputs || changeset) return null;
  // Versioned already, by a release pull request: the release publishes it.
  if (published !== null && published !== version) return null;
  return `${PACKAGE}'s inputs changed, in the engine's Yoga or in the package, and nothing will publish them: add a changeset for it (pnpm changeset).`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { fingerprint } = yogaInputs();
  let problem;
  if (process.argv.includes('--built')) {
    problem = builtProblem(
      JSON.parse(readFileSync(join(packageRoot, 'dist/build.json'), 'utf8')),
      fingerprint,
    );
  } else {
    const directory = join(repository, '.changeset');
    const changeset = readdirSync(directory)
      .filter((name) => name.endsWith('.md') && name !== 'README.md')
      .some((name) =>
        namesPackage(readFileSync(join(directory, name), 'utf8')),
      );
    const { version } = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf8'),
    );
    const published = await latestPackage();
    problem = releaseProblem({
      sameInputs:
        published !== null && (await publishedModule(fingerprint)) !== null,
      published: published?.version ?? null,
      version,
      changeset,
    });
  }
  if (problem !== null) {
    console.error(problem);
    process.exitCode = 1;
  }
}
