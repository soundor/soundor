// The connector with the real pieces: the Debug build of the JUCE test plugin
// in the real VST3 host, under a display. Runs only when told where it is:
//
//   pnpm --filter @soundor/vst3-host build:native
//   pnpm --filter @soundor/juce-runtime test:plugin:debug
//   SOUNDOR_DRIVER_VST3_PLUGIN=<runtimes/juce-runtime/tests/plugin/.soundor/debug/juce/VST3/Soundor Test Plugin.vst3> \
//     xvfb-run -a pnpm --filter @soundor/driver exec vitest run src/vst3.plugin.test.ts
import { existsSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { isDriverError } from './errors';
import { launch, type Vst3Plugin } from './vst3';

const path = process.env['SOUNDOR_DRIVER_VST3_PLUGIN'];
const fixtures = process.env['SOUNDOR_VST3_HOST_FIXTURES'];

describe.runIf(path)('the test plugin in the VST3 host', () => {
  let plugin: Vst3Plugin;

  afterEach(() => plugin?.close());

  async function bypass(): Promise<number> {
    const parameters = await plugin.host.getParameters();
    return parameters.find(({ title }) => title === 'Bypass')!.normalized;
  }

  it('clicks in the UI reach the processor', async () => {
    plugin = await launch({ plugin: path! });
    expect((await plugin.driver.target()).name).toBe('Soundor Test Plugin');
    expect(await bypass()).toBe(0);

    await plugin.driver.getByText('Active').click();
    await plugin.driver.getByText('Bypassed').waitFor();
    expect(await bypass()).toBe(1);

    const { frames } = await plugin.host.process({ frames: 256 });
    expect(frames).toBe(256);
  }, 30_000);

  it('shows parameters set through the host in the UI', async () => {
    plugin = await launch({ plugin: path! });
    const { id } = (await plugin.host.getParameters())[0]!;
    await plugin.host.setParameter(id, 0.25);
    await plugin.driver.getByText('Gain: 0.25').waitFor();
    expect(await plugin.driver.getByText('Gain: 0.25').getNode()).toMatchObject(
      { text: 'Gain: 0.25' },
    );
  }, 30_000);

  it('captures the view at the editor size', async () => {
    plugin = await launch({ plugin: path! });
    const { width, height } = await plugin.driver.screenshot();
    expect({ width, height }).toEqual({ width: 640, height: 480 });
  }, 30_000);

  it('works with the editor reopened, in another presentation too', async () => {
    plugin = await launch({ plugin: path! });
    const first = plugin.driver;

    await plugin.openEditor();
    expect(plugin.driver).toBe(first);

    await plugin.host.closeEditor();
    await plugin.openEditor();
    expect(plugin.driver).not.toBe(first);
    await plugin.driver.getByText('Active').waitFor();

    const second = plugin.driver;
    await plugin.openEditor({ presentation: 'host' });
    expect(plugin.driver).not.toBe(second);
    await plugin.driver.getByText('Active').click();
    expect(await bypass()).toBe(1);

    await plugin.host.recreate();
    await plugin.openEditor();
    expect(await bypass()).toBe(0);
    await plugin.driver.getByText('Active').waitFor();
  }, 60_000);

  it('reports a crash promptly and still closes', async () => {
    plugin = await launch({ plugin: path! });
    const { driver, descriptorPath } = plugin;
    process.kill(plugin.host.pid!, 'SIGKILL');
    await plugin.host.exited;
    await expect
      .poll(
        () =>
          driver.getTree({ timeout: 1000 }).then(
            () => '',
            (error: unknown) =>
              isDriverError(error) ? error.code : String(error),
          ),
        { timeout: 5000 },
      )
      .toBe('TARGET_DISCONNECTED');
    await plugin.close();
    expect(existsSync(descriptorPath)).toBe(false);
  }, 30_000);

  it.runIf(fixtures)(
    'fails clearly for a plugin without DevTools',
    async () => {
      await expect(
        launch({
          plugin: `${fixtures}/SoundorHostFixtures.vst3`,
          className: 'Fixture Gain',
          targetTimeout: 500,
        }),
      ).rejects.toSatisfy((error) => isDriverError(error, 'NO_TARGETS'));
    },
    30_000,
  );
});
