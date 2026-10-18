import type { DebugMetrics } from '@soundor/devtools-protocol';
import { expect, it } from 'vitest';

import { setup, page, until } from './helpers';

it('shows native animation targets and lifecycle events, and clears them on reload', async () => {
  const { page: browser, native } = await setup(true);
  await browser.ready();
  browser.click('tab-animations');
  await until(() => browser.text('animations').includes('opacity'));
  expect(browser.text('animations')).toContain('50.0 ms');
  await browser.select();
  await until(() => browser.text('details').includes('Animations'));
  native.setAnimations([]);
  await native.event('Animation.changed', {
    generation: 1,
    changes: [
      {
        id: '1',
        node: { generation: 1, id: '3' },
        playbackGeneration: 0,
        state: 'cancelled',
      },
    ],
    truncated: false,
  });
  await until(() => browser.text('animations').includes('cancelled'));
  await native.reload();
  await until(() => browser.text('target-meta').includes('generation 2'));
  expect(browser.text('animations')).not.toContain('cancelled');
});
it('records diagnostics from any tab and shares measured samples with the others', async () => {
  const { server, page: recorder, native } = await setup(true);
  await recorder.ready();
  const observer = await page(server);
  await observer.ready();
  observer.click('tab-performance');
  expect(observer.get('record-performance').hasAttribute('disabled')).toBe(
    false,
  );
  recorder.click('tab-performance');
  recorder.click('record-performance');
  await until(
    () =>
      recorder.text('performance-status') === 'Recording · 10 Hz samples' &&
      !recorder.get('record-performance').hasAttribute('disabled'),
  );
  const sample: DebugMetrics = {
    generation: 1,
    recording: true,
    elapsedMs: 100,
    frameCount: 6,
    delayedTicks: 0,
    tickIntervalMs: 16.5,
    phases: { webMs: 0.1, ticks: 6 },
    frames: [
      {
        timestampMs: 100,
        frameMs: 4,
        productionMs: 3,
        compositionMs: 1,
        rasterMs: 2,
        layoutMs: 0.5,
        mode: 'cpu',
        backend: 'Skia raster',
        layerCount: 2,
        layersRasterized: 1,
        pixelsRasterized: 100,
        gpuLayers: 0,
        gpuReadbacks: 0,
        cachedRasterBytes: 400,
        layersComposited: 2,
        pixelsComposited: 100,
        bytesUploaded: 0,
        textureAllocations: 0,
        drawCalls: 0,
        compositorReadbacks: 0,
      },
    ],
  };
  await native.setMetrics(sample);
  await until(() =>
    observer.text('performance-summary').includes('Skia raster'),
  );
  expect(
    recorder.get('performance-chart').querySelector('polyline'),
  ).not.toBeNull();
  recorder.click('record-performance');
  await until(() => recorder.text('record-performance') === 'Start recording');
  expect(recorder.text('performance-summary')).toContain('4.00');
  // The other tab sees the recording stop.
  await until(() => observer.text('record-performance') === 'Start recording');
});
it('reports unsupported diagnostics and never records without them', async () => {
  const { page: browser, native } = await setup();
  await browser.ready();
  browser.click('tab-performance');
  expect(browser.text('performance-status')).toContain('does not support');
  browser.click('record-performance');
  expect(native.methods).not.toContain('Diagnostics.setRecording');
  browser.click('tab-animations');
  expect(browser.text('animations')).toContain('does not support');
});
