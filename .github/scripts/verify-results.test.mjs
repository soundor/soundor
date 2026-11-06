import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyResults } from './verify-results.mjs';

function jobs(flags = {}) {
  return {
    changes: {
      result: 'success',
      outputs: {
        native: 'false',
        juce: 'false',
        benchmark: 'false',
        host: 'false',
        orbit: 'false',
        ...flags,
      },
    },
    workspace: { result: 'success' },
    ...Object.fromEntries(
      [
        'engine-plan',
        'engine-artifacts',
        'engine',
        'benchmark',
        'juce8',
        'juce9',
        'host-plan',
        'host',
        'orbit',
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
  needs.juce8.result = 'success';
  needs.juce9.result = 'success';
  needs['engine-plan'] = { result: 'success', outputs: { build: 'true' } };
  assert.throws(() => verifyResults(needs), /engine-artifacts=skipped/);
  needs['engine-artifacts'].result = 'success';
  verifyResults(needs);
  needs['engine-plan'].outputs.build = 'false';
  needs['engine-artifacts'].result = 'skipped';
  verifyResults(needs);
});
test('failures, cancellations and detection failures always fail', () => {
  for (const name of ['changes', 'workspace', 'engine-artifacts']) {
    for (const result of ['failure', 'cancelled']) {
      const needs = jobs();
      needs[name].result = result;
      assert.throws(() => verifyResults(needs));
    }
  }
});
test('an affected VST3 host requires its native checks', () => {
  const needs = jobs({ host: 'true' });
  assert.throws(() => verifyResults(needs), /Host planning/);
  needs['host-plan'] = { result: 'success', outputs: { build: 'false' } };
  assert.throws(() => verifyResults(needs), /Affected host/);
  needs['host-plan'].outputs.build = 'true';
  assert.throws(() => verifyResults(needs), /host=skipped/);
  needs.host.result = 'success';
  verifyResults(needs);
  // Host changes alone never require the engine's suites.
  for (const name of ['engine', 'engine-artifacts', 'juce8', 'juce9'])
    assert.equal(needs[name].result, 'skipped');
});
test('affected Orbit tests require their job and what they use', () => {
  const needs = jobs({ orbit: 'true' });
  assert.throws(() => verifyResults(needs), /Host planning/);
  needs['host-plan'] = { result: 'success', outputs: { build: 'true' } };
  assert.throws(() => verifyResults(needs), /Engine planning/);
  needs['engine-plan'] = { result: 'success', outputs: { build: 'false' } };
  assert.throws(() => verifyResults(needs), /host=skipped/);
  needs.host.result = 'success';
  assert.throws(() => verifyResults(needs), /orbit=skipped/);
  needs.orbit.result = 'success';
  verifyResults(needs);
  // A released host that matches needs no build.
  needs['host-plan'].outputs.build = 'false';
  needs.host.result = 'skipped';
  verifyResults(needs);
});
test('an affected JUCE runtime requires both versions of JUCE', () => {
  const needs = jobs({ juce: 'true' });
  needs['engine-plan'] = { result: 'success', outputs: { build: 'false' } };
  needs.juce8.result = 'success';
  assert.throws(() => verifyResults(needs), /juce9=skipped/);
  needs.juce9.result = 'failure';
  assert.throws(() => verifyResults(needs), /juce9=failure/);
  needs.juce9.result = 'success';
  verifyResults(needs);
});
