// CI smoke assertions concern measurement and work, never machine-dependent FPS.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const native = report.environment.build.animationMode === 'native';
assert.equal(report.environment.build.execution, 'hermes-bytecode');
assert.match(report.environment.build.hermesRevision, /^[a-f0-9]{40}$/);
for (const run of report.runs) {
  assert.equal(run.outcome, 'ok');
  const advanced = run.value.every((result: { scenario: string }) =>
    result.scenario.startsWith('advanced:'),
  );
  assert.ok(
    advanced
      ? run.value.length === 14
      : run.value.length === 13 || run.value.length === 16,
  );
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
    assert.equal(
      advanced ? phase.frames + phase.idleTicks : phase.frames,
      report.config.frames,
      phase.name,
    );
    const { mean, p50, p95, p99, max, standardDeviation } = phase.frameMs;
    for (const value of [mean, p50, p95, p99, max, standardDeviation])
      assert.ok(Number.isFinite(value) && value >= 0);
    assert.ok(p50 <= p95 && p95 <= p99 && p99 <= max);
    if (
      /animation-(opacity|react|transform)-/.test(phase.name) ||
      (advanced &&
        !phase.name.includes(':retarget:') &&
        !phase.name.includes(':paint:'))
    ) {
      assert.equal(phase.surface.layoutPasses, 0);
      if (native) {
        assert.equal(phase.layersRasterized, 0, phase.name);
        assert.equal(phase.bytesUploaded, 0, phase.name);
        assert.equal(phase.surface.styleChanges, 0, phase.name);
        assert.equal(phase.nativeCalls.ui.perFrame, 0, phase.name);
      } else
        assert.equal(
          phase.nativeCalls.ui.perFrame,
          advanced
            ? Number(phase.name.split(':').at(-1)) *
                (phase.name.includes(':parallel:') ? 2 : 1)
            : Number(phase.name.split('-').at(-1)),
        );
    }
  }
}
console.log(
  'Animation report: measurement counts, tails and compositor invariants verified.',
);
