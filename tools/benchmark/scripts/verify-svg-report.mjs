// Stable work counts and lifecycle invariants, never an FPS threshold.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(report.environment.build.execution, 'hermes-bytecode');
assert.equal(report.environment.build.scriptScale, true);
for (const run of report.runs) {
  assert.equal(run.outcome, 'ok');
  assert.equal(run.value.length, 13);
  for (const phase of run.phases) {
    const name = phase.name;
    assert.equal(phase.ticks, report.config.frames, name);
    assert.equal(phase.gpuReadbacks, 0, name);
    if (/^svg-static-\d+$/.test(name)) {
      assert.equal(phase.frames, 0, name);
      assert.equal(phase.idleTicks, report.config.frames, name);
    }
    if (/^svg-color-\d+$/.test(name) || name === 'svg-path-100') {
      assert.equal(
        phase.surface.svgSceneUpdates,
        Number(name.split('-').at(-1)),
        name,
      );
      assert.equal(phase.surface.layoutPasses, 0, name);
      assert.equal(
        phase.surface.svgPathParses,
        name === 'svg-path-100' ? 1 : 0,
        name,
      );
    }
    if (name === 'svg-large-color') {
      assert.equal(phase.surface.svgSceneUpdates, 1);
      assert.equal(phase.surface.svgPathParses, 0);
    }
    if (name === 'svg-static-unrelated') {
      assert.equal(phase.surface.svgSceneUpdates, 0);
      assert.equal(phase.surface.svgPathParses, 0);
      assert.equal(phase.surface.svgDraws, 0);
      assert(phase.frames > 0);
    }
    if (name === 'svg-editor-scale') {
      assert.equal(phase.renderScale.min, 0.5);
      assert.equal(phase.renderScale.max, 2);
      assert.equal(phase.surface.svgSceneUpdates, 0);
      assert.equal(phase.surface.svgPathParses, 0);
      // Each changed point scale re-snaps the two existing Yoga roots.
      assert.equal(phase.surface.layoutPasses, 2);
      assert(phase.layersRasterized > 0);
    }
  }
}
console.log(
  'SVG report: scene/path/update counts, idle/damage behavior and actual editor render-scale changes verified.',
);
