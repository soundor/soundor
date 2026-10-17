import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

test('Orbit plays real audio and edits its delay through the portable controls', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const original = AudioNode.prototype.connect;
    const destination = window as unknown as {
      orbitAnalyser?: AnalyserNode;
      orbitInputAnalyser?: AnalyserNode;
      orbitDemoStart?: number;
    };
    Object.defineProperty(AudioNode.prototype, 'connect', {
      value: function (this: AudioNode, ...args: unknown[]) {
        const result = Reflect.apply(original, this, args);
        if (args[0] instanceof AudioWorkletNode) {
          destination.orbitInputAnalyser ??= this.context.createAnalyser();
          destination.orbitInputAnalyser.fftSize = 2048;
          Reflect.apply(original, this, [destination.orbitInputAnalyser]);
          if (this instanceof AudioBufferSourceNode)
            destination.orbitDemoStart = this.context.currentTime;
        }
        if (args[0] === this.context.destination) {
          const analyser = this.context.createAnalyser();
          analyser.fftSize = 2048;
          Reflect.apply(original, this, [analyser]);
          destination.orbitAnalyser = analyser;
        }
        return result;
      },
    });
  });
  // Exercise the production build below a nested path, including its worklet.
  await page.goto('/examples/orbit/');
  await expect(
    page.getByRole('slider', { name: 'Echo 1 time', exact: true }),
  ).toHaveAttribute('aria-valuenow', '0.75');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const analyser = (window as unknown as { orbitAnalyser?: AnalyserNode })
          .orbitAnalyser;
        if (!analyser) return 0;
        const samples = new Float32Array(2048);
        analyser.getFloatTimeDomainData(samples);
        return Math.sqrt(
          samples.reduce((sum, sample) => sum + sample * sample, 0) /
            samples.length,
        );
      }),
    )
    .toBeGreaterThan(0.001);

  // In the deliberate gap after the phrase, the input is silent but Orbit
  // must produce clearly measurable repeats. Nonzero output alone would let
  // a broken passthrough implementation pass this test.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const meter = window as unknown as {
            orbitAnalyser: AnalyserNode;
            orbitInputAnalyser: AnalyserNode;
            orbitDemoStart: number;
          };
          if (!meter.orbitInputAnalyser || meter.orbitDemoStart === undefined)
            return false;
          const elapsed =
            (meter.orbitAnalyser.context.currentTime - meter.orbitDemoStart) %
            4;
          if (elapsed < 1.5 || elapsed > 3.8) return false;
          const input = new Float32Array(2048),
            output = new Float32Array(2048);
          meter.orbitInputAnalyser.getFloatTimeDomainData(input);
          meter.orbitAnalyser.getFloatTimeDomainData(output);
          const rms = (samples: Float32Array) =>
            Math.sqrt(
              samples.reduce((sum, sample) => sum + sample * sample, 0) /
                samples.length,
            );
          return rms(input) < 0.00001 && rms(output) > 0.002;
        }),
      { timeout: 10000, intervals: [50] },
    )
    .toBe(true);

  const echo = page.getByRole('slider', { name: 'Echo 1 time', exact: true });
  const box = (await echo.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 90,
    box.y + box.height / 2 - 20,
    { steps: 8 },
  );
  await page.mouse.up();
  expect(Number(await echo.getAttribute('aria-valuenow'))).toBeGreaterThan(
    0.75,
  );
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  await expect(page.getByText('LOOP HELD', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next preset', exact: true }).click();
  await expect(page.getByText('Warm magnetic', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Hold', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('slider', { name: 'Mix', exact: true }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(
    page.getByRole('slider', { name: 'Mix', exact: true }),
  ).toHaveAttribute('aria-valuenow', '0.61');
  await page.getByRole('radio', { name: 'Original', exact: true }).click();
  await expect(
    page.getByText('Bypassed · original audio', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

for (const failure of ['unavailable', 'shader failure'] as const) {
  test(`Orbit retains its display and controls without WebGL: ${failure}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((mode) => {
      const original = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value: function (
          this: HTMLCanvasElement,
          kind: string,
          options?: unknown,
        ) {
          if (kind === 'webgl2' && mode === 'unavailable') return null;
          const context = Reflect.apply(original, this, [kind, options]);
          if (
            kind === 'webgl2' &&
            context instanceof WebGL2RenderingContext &&
            mode === 'shader failure'
          ) {
            context.getShaderParameter = () => false;
            context.getShaderInfoLog = () => 'Forced shader failure';
          }
          return context;
        },
      });
    }, failure);
    await page.goto('/examples/orbit/');
    await expect(
      page.getByRole('slider', { name: 'Echo 1 time', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('canvas')
          .first()
          .evaluate((canvas) => {
            const context = (canvas as HTMLCanvasElement).getContext('2d');
            if (!context) return false;
            const pixel = context.getImageData(0, 0, 1, 1).data;
            return pixel[3] === 255;
          }),
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Hold', exact: true }).click();
    await expect(page.getByText('LOOP HELD', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
