// The package with the real pieces: the Debug build of the JUCE test plugin in
// the real VST3 host, under a display. Runs only when told where it is:
//
//   pnpm --filter @soundor/vst3-host build:native
//   pnpm --filter @soundor/juce-runtime test:plugin:debug
//   SOUNDOR_VITEST_E2E_PLUGIN=<runtimes/juce-runtime/tests/plugin/.soundor/debug/juce/VST3/Soundor Test Plugin.vst3> \
//     xvfb-run -a pnpm --filter @soundor/vitest-e2e exec vitest run src/plugin.test.ts
import { describe, expect, test } from 'vitest';

import { launchHost, launchPlugin } from './launch';

const path = process.env['SOUNDOR_VITEST_E2E_PLUGIN'];
// This package's own Vitest config names a project that does not exist.
const here = { cwd: process.cwd() };

describe.runIf(path)('the test plugin in the VST3 host', () => {
  const started = () => launchPlugin({ ...here, plugin: path! });

  test('a click reaches the UI and the processor, in one test', async () => {
    const plugin = await started();
    const bypass = plugin.parameter('Bypass');
    expect((await bypass.get()).normalized).toBe(0);

    await plugin.getByText('Active').click();
    await expect(plugin.getByText('Bypassed')).toBeVisible();
    await expect(plugin.getByText('Active')).toBeHidden();

    await expect.poll(async () => (await bypass.get()).normalized).toBe(1);
    const { frames } = await plugin.host.process({ frames: 256 });
    expect(frames).toBe(256);
  }, 30_000);

  test('a parameter set through the host shows in the UI', async () => {
    const plugin = await started();
    await plugin.parameter('Gain').set(0.25);
    await expect(plugin.getByText('Gain: 0.25')).toHaveText(/Gain: 0\.25/);
  }, 30_000);

  test('locators keep working when the editor is reopened', async () => {
    const plugin = await started();
    const active = plugin.getByText('Active');
    await expect(active).toBeVisible();

    await plugin.host.closeEditor();
    await plugin.openEditor();
    await expect(active).toBeVisible();

    await plugin.host.recreate();
    await plugin.openEditor();
    await active.click();
    await expect(plugin.getByText('Bypassed')).toBeVisible();
  }, 60_000);

  test('screenshots show the current editor', async () => {
    const plugin = await started();
    expect((await plugin.screenshot()).width).toBe(640);
    await plugin.host.closeEditor();
    await plugin.openEditor();
    expect((await plugin.screenshot()).width).toBe(640);
  }, 30_000);

  test('two plugins are separate instances', async () => {
    const first = await started();
    const second = await started();
    await first.getByText('Active').click();
    await expect(first.getByText('Bypassed')).toBeVisible();
    await expect(second.getByText('Active')).toBeVisible();
  }, 30_000);

  test('a host alone needs no editor', async () => {
    const host = await launchHost({ ...here, plugin: path! });
    expect((await host.getEditor()).open).toBe(false);
    await host.parameter('Gain').set(0.25);
    expect((await host.parameter('Gain').get()).normalized).toBe(0.25);
    const state = await host.getState();
    await host.close();

    const next = await launchHost({
      ...here,
      plugin: path!,
      sampleRate: 44_100,
    });
    await next.process({ frames: 512 });
    await next.setState(state);
    expect((await next.parameter('Gain').get()).normalized).toBeCloseTo(0.25);
  }, 30_000);
});
