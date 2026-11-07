// CI selection: keep affected packages' native checks, otherwise prefer the
// published binary, then a complete matching build from successful main CI.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { engineInputs } from '../../engines/engine/scripts/engine-inputs.mjs';
import { selectEngine } from '../../engines/engine/scripts/engine-selection.mjs';
import { nativeInputs } from '../../hosts/vst3-host/src/inputs.ts';
import { selectHost } from '../../hosts/vst3-host/src/prepare.ts';
import {
  artifactKey,
  findMainArtifacts,
  planNativeBuild,
} from './native-artifacts.mjs';

const kind = process.argv[2];
if (!['engine', 'host'].includes(kind))
  throw new Error('Expected engine or host');
const affected = process.env.NATIVE_AFFECTED === 'true';
const cache = join(process.env.RUNNER_TEMP, 'soundor-cache');
const { fingerprint } =
  kind === 'engine' ? engineInputs('engines/engine') : nativeInputs();
const selection = affected
  ? { mode: 'source', reason: `${kind} package affected` }
  : kind === 'engine'
    ? await selectEngine('engines/engine', cache)
    : await selectHost();
const key = artifactKey(kind, fingerprint);
// Main keeps same-commit artifacts for release publishing. Affected packages
// still build and run their native checks; a fingerprint is not a test result.
const { build, reused } = await planNativeBuild({
  affected,
  event: process.env.GITHUB_EVENT_NAME,
  selection,
  find: () => findMainArtifacts({ kind, key }),
});
console.log(
  reused
    ? { mode: 'artifact', reason: 'matching successful main build', ...reused }
    : selection,
);
const directory = join(process.env.RUNNER_TEMP, `native-${kind}-index`);
mkdirSync(directory, { recursive: true });
writeFileSync(
  join(directory, 'inputs.json'),
  JSON.stringify({ fingerprint, key, commit: process.env.GITHUB_SHA }),
);
appendFileSync(
  process.env.GITHUB_OUTPUT,
  [
    `build=${build}`,
    `artifact-run=${reused?.run ?? ''}`,
    `artifact-commit=${reused?.commit ?? ''}`,
    `artifact-key=${key}`,
  ].join('\n') + '\n',
);
