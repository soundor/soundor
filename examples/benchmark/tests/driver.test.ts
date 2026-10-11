import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Driver } from '../src/driver.ts';
import {
  animationOpacity,
  animationValue,
} from '../src/scenarios/animation-workload.ts';
import type { Scenario } from '../src/scenarios/types.ts';

test('warmup, phase labels and long runs count exactly the measured frames', async () => {
  let callback: ((time: number) => void) | undefined;
  globalThis.requestAnimationFrame = (next) => {
    callback = next;
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {};
  const scenario = {
    id: 'test',
    group: 'animation',
    stepSeconds: 1 / 60,
  } as Scenario;
  for (const warmup of [0, 1, 30]) {
    const driver = new Driver(scenario);
    const times: number[] = [];
    driver.register((time) => {
      times.push(time);
    });
    const done = driver.runAll([scenario], 1000, warmup);
    let measured = 0;
    for (let frame = 0; frame < warmup + 1000; frame++) {
      if (globalThis.soundorRunUiPhase === scenario.id) measured++;
      callback!(frame);
    }
    callback!(warmup + 1000);
    const [result] = await done;
    assert.equal(result!.frames, 1000);
    assert.equal(measured, 1000);
    assert.equal(times.length, warmup + 1000);
    assert.equal(times[0], 0);
    assert.ok(Math.abs(times.at(-1)! - (times.length - 1) / 60) < 1e-12);
    assert.equal(globalThis.soundorRunUiPhase, undefined);
    driver.dispose();
  }
});

test('empty selection completes and invalid frame counts fail immediately', async () => {
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const driver = new Driver({ id: 'test', group: 'animation' } as Scenario);
  assert.deepEqual(await driver.runAll([], 1, 0), []);
  for (const frames of [0, -1, 1.5, NaN])
    assert.throws(() => driver.runAll([], frames), RangeError);
  assert.throws(() => driver.runAll([], 1, -1), RangeError);
  driver.dispose();
});

test('linear alternating ramp has fixed endpoints and bounded deterministic offsets', () => {
  assert.equal(animationValue(0, 0), 0);
  assert.equal(animationValue(0.5, 0), 0.5);
  assert.equal(animationValue(1, 0), 1);
  assert.equal(animationValue(2, 0), 0);
  for (let frame = 0; frame < 600; frame++)
    for (let node = 0; node < 500; node++) {
      const opacity = animationOpacity(frame / 60, node);
      assert.ok(opacity >= 0.25 && opacity <= 1);
      assert.ok(
        Math.abs(opacity - animationOpacity(frame / 60 + 2, node)) < 1e-12,
      );
    }
});
