// CI smoke assertions concern measurement and work, never machine-dependent FPS.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
assert.equal(report.environment.build.execution, 'hermes-bytecode');
assert.match(report.environment.build.hermesRevision, /^[a-f0-9]{40}$/);
for (const run of report.runs) {
  assert.equal(run.outcome, 'ok');
  assert.equal(run.value.length, 13);
  for (const result of run.value)
    assert.equal(result.frames, report.config.frames);
  for (const phase of run.phases) {
    assert.equal(phase.ticks, report.config.frames, phase.name);
    assert.equal(phase.gpuReadbacks, 0, phase.name);
    assert.equal(phase.nativeCalls.canvas.perFrame, 0, phase.name);
    assert.equal(phase.nativeCalls.webgl.perFrame, 0, phase.name);
    if (phase.name.startsWith('animation-static-')) {
      assert.equal(phase.frames, 0);
      assert.equal(phase.idleTicks, report.config.frames);
      continue;
    }
    assert.equal(phase.frames, report.config.frames, phase.name);
    const { mean, p50, p95, p99, max, standardDeviation } = phase.frameMs;
    for (const value of [mean, p50, p95, p99, max, standardDeviation])
      assert.ok(Number.isFinite(value) && value >= 0);
    assert.ok(p50 <= p95 && p95 <= p99 && p99 <= max);
    if (/animation-(opacity|react)-/.test(phase.name)) {
      assert.equal(phase.surface.layoutPasses, 0);
      assert.equal(
        phase.nativeCalls.ui.perFrame,
        Number(phase.name.split('-').at(-1)),
      );
    }
  }
}
console.log(
  'Animation report: measurement counts, tails and compositor invariants verified.',
);
