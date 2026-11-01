// Actual production React/Hermes/vector output, compared with an independent
// SVG document render. Timings are deliberately not asserted by this test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const project = fileURLToPath(new URL('../', import.meta.url));
const engine = resolve(project, '../../runtimes/engine');
function run(command, args, cwd = project) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === 'win32' && command === 'pnpm',
  });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`,
    );
  return result.stdout;
}
run('pnpm', ['turbo', 'run', 'build', '--filter=soundor-benchmark^...']);
run('cmake', ['--preset', 'dev'], engine);
run(
  'cmake',
  ['--build', '--preset', 'dev', '--target', 'soundor_run_ui'],
  engine,
);
run(process.execPath, [join(project, 'scripts/svg-fixture.mjs')]);
const directory = join(project, '.soundor/svg-fixture');
run(process.execPath, [
  join(engine, 'cmake/SoundorLowerJs.mjs'),
  join(directory, 'bundle.mjs'),
  join(directory, 'bundle.js'),
]);
run('cmake', [
  `-DINPUT=${join(directory, 'bundle.js')}`,
  `-DOUTPUT=${join(directory, 'bundle.js.hbc')}`,
  '-DNAME=/bundle.js',
  '-P',
  join(engine, 'build/dev/soundor-compile-js.cmake'),
]);
const exe =
  process.platform === 'win32' ? 'soundor_run_ui.exe' : 'soundor_run_ui';
const runner = [
  join(engine, 'build/dev/tests', exe),
  join(engine, 'build/dev/tests/Debug', exe),
].find(existsSync);
assert(runner, 'native runner');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
async function pixels(png) {
  return page.evaluate(async (encoded) => {
    const bitmap = await createImageBitmap(
      await (await fetch('data:image/png;base64,' + encoded)).blob(),
    );
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return {
      width: canvas.width,
      height: canvas.height,
      data: Array.from(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      ),
    };
  }, readFileSync(png).toString('base64'));
}
async function capture(mode, scale = 1) {
  const path = join(directory, `native-${mode}-${scale}.png`),
    json = join(directory, `native-${mode}-${scale}.json`);
  const expression =
    mode === 'grow'
      ? 'soundorSvgProbe.run("grow")'
      : `soundorSvgProbe.test(${JSON.stringify(mode)})`;
  run(runner, [
    directory,
    '--size',
    '220x110',
    '--scale',
    String(scale),
    '--eval',
    expression,
    '--software',
    '--bytecode',
    '--capture',
    path,
    '--json',
    json,
  ]);
  const report = JSON.parse(readFileSync(json, 'utf8'));
  assert.equal(report.outcome, 'ok');
  assert.equal(
    report.total.gpuReadbacks,
    0,
    'measurement performs no GPU readback',
  );
  if (mode !== 'idle') {
    assert.equal(report.value.sameRoot, true);
    assert.equal(report.value.children, 0);
    assert.equal(report.value.width, mode === 'clear' ? 0 : 100);
  }
  return { report, image: await pixels(path) };
}
function color(image, x, y) {
  const at = (y * image.width + x) * 4;
  return image.data.slice(at, at + 4);
}
try {
  let worst = 0;
  for (const scale of [0.5, 1, 1.5, 2, 3, 4]) {
    const { report, image } = await capture('grow', scale);
    assert.equal(image.width, 220 * scale);
    assert.equal(image.height, 110 * scale);
    const side = 100 * scale,
      left = 110 * scale;
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++)
        for (let c = 0; c < 4; c++)
          worst = Math.max(
            worst,
            Math.abs(
              image.data[(y * image.width + x) * 4 + c] -
                image.data[(y * image.width + left + x) * 4 + c],
            ),
          );
    assert(
      worst <= 16,
      `React scene versus SVG Image: max channel difference ${worst}`,
    );
    assert.equal(
      report.total.surface.svgSceneUpdates,
      0,
      'viewport change does not publish a scene',
    );
    assert.equal(
      report.total.surface.svgPathParses,
      0,
      'viewport change reuses paths',
    );
  }
  const active = await capture('active');
  assert.deepEqual(color(active.image, 25, 50), [0, 0, 255, 255]);
  const changed = active.report.phases.find(
    (phase) => phase.name === 'svg-update',
  );
  assert.equal(changed.surface.svgSceneUpdates, 1);
  assert.equal(changed.surface.svgPathParses, 0);
  assert.equal(changed.surface.layoutPasses, 0);
  const reordered = await capture('reorder');
  assert.deepEqual(color(reordered.image, 50, 50), [255, 0, 0, 255]);
  const path = await capture('path');
  assert.equal(
    path.report.phases.find((phase) => phase.name === 'svg-update').surface
      .svgPathParses,
    1,
  );
  const cleared = await capture('clear');
  assert(cleared.report.value.unmounted);
  assert(!cleared.report.value.connected);
  assert.deepEqual(color(cleared.image, 25, 50), [255, 255, 255, 255]);
  const idle = await capture('idle');
  const phase = idle.report.phases.find((phase) => phase.name === 'svg-static');
  assert.equal(phase.frames, 0);
  assert(phase.idleTicks >= 8);
  assert.equal(phase.surface.svgSceneUpdates, 0);
  assert.equal(phase.surface.svgDraws, 0);
  console.log(
    `Native React SVG: 11 bytecode renders passed; six physical scales, max document/scene channel difference ${worst}; paint/path/order/unmount/idle checks passed.`,
  );
  console.log(
    `Device: ${active.report.device.renderer}; software=${active.report.device.software}`,
  );
} finally {
  await browser.close();
}
