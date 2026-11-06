import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyResults(needs) {
  const required = new Set(['changes', 'fast']);
  const changes = needs.changes?.outputs ?? {};
  if (
    ['native', 'juce', 'benchmark', 'host', 'orbit'].some(
      (name) => !['true', 'false'].includes(changes[name]),
    )
  )
    throw new Error('Native input detection did not return every decision');
  if (changes.native === 'true') required.add('engine');
  if (changes.benchmark === 'true') required.add('benchmark');
  if (changes.juce === 'true') {
    required.add('juce8');
    required.add('juce9');
  }
  if (changes.orbit === 'true') required.add('orbit');
  if (changes.host === 'true' || changes.orbit === 'true')
    required.add('host-plan');
  if (
    required.has('host-plan') &&
    !['true', 'false'].includes(needs['host-plan']?.outputs?.build)
  )
    throw new Error('Host planning did not return a build decision');
  if (changes.host === 'true' && needs['host-plan']?.outputs?.build !== 'true')
    throw new Error('Affected host must use checkout artifacts');
  if (needs['host-plan']?.outputs?.build === 'true') required.add('host');
  if (
    changes.native === 'true' ||
    changes.juce === 'true' ||
    changes.orbit === 'true'
  )
    required.add('engine-plan');
  if (
    required.has('engine-plan') &&
    !['true', 'false'].includes(needs['engine-plan']?.outputs?.build)
  )
    throw new Error('Engine planning did not return a build decision');
  if (
    changes.native === 'true' &&
    needs['engine-plan']?.outputs?.build !== 'true'
  )
    throw new Error('Affected engine must use checkout artifacts');
  if (needs['engine-plan']?.outputs?.build === 'true')
    required.add('engine-artifacts');
  const failed = Object.entries(needs).filter(
    ([name, job]) =>
      ['failure', 'cancelled'].includes(job.result) ||
      (required.has(name) && job.result !== 'success'),
  );
  for (const name of required)
    if (!needs[name]) failed.push([name, { result: 'missing' }]);
  if (failed.length)
    throw new Error(
      `Verification did not complete: ${failed.map(([name, job]) => `${name}=${job.result}`).join(', ')}`,
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  verifyResults(JSON.parse(process.env.NEEDS));
  console.log('All applicable verification passed');
}
