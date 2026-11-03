import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyResults } from './verify-results.mjs';

function jobs(flags = {}) {
  return {
    changes: {
      result: 'success',
      outputs: { native: 'false', juce: 'false', benchmark: 'false', ...flags },
    },
    fast: { result: 'success' },
    ...Object.fromEntries(
      [
        'engine-plan',
        'engine-artifacts',
        'engine',
        'native',
        'benchmark',
        'juce',
      ].map((name) => [name, { result: 'skipped' }]),
    ),
  };
}
test('intentional native skips pass', () => verifyResults(jobs()));
test('a skipped affected job fails', () => {
  const needs = jobs({ native: 'true' });
  needs['engine-plan'] = { result: 'success', outputs: { build: 'true' } };
  assert.throws(() => verifyResults(needs), /engine=skipped/);
});
test('missing decisions and affected engines using a release fail', () => {
  const needs = jobs({ native: 'true' });
  assert.throws(() => verifyResults(needs), /Engine planning/);
  needs['engine-plan'] = { result: 'success', outputs: { build: 'false' } };
  assert.throws(() => verifyResults(needs), /Affected engine/);
  needs.changes.outputs = {};
  assert.throws(() => verifyResults(needs), /input detection/);
});
test('consumer checks require engine planning and the chosen artifacts', () => {
  const needs = jobs({ juce: 'true' });
  needs.juce.result = 'success';
  needs['engine-plan'] = { result: 'success', outputs: { build: 'true' } };
  assert.throws(() => verifyResults(needs), /engine-artifacts=skipped/);
  needs['engine-artifacts'].result = 'success';
  verifyResults(needs);
  needs['engine-plan'].outputs.build = 'false';
  needs['engine-artifacts'].result = 'skipped';
  verifyResults(needs);
});
test('failures, cancellations and detection failures always fail', () => {
  for (const name of ['changes', 'fast', 'engine-artifacts']) {
    for (const result of ['failure', 'cancelled']) {
      const needs = jobs();
      needs[name].result = result;
      assert.throws(() => verifyResults(needs));
    }
  }
});
