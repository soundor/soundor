import { expect, test } from '@playwright/test';

test.use({
  launchOptions: {
    args: [
      '--enable-unsafe-swiftshader',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  },
});

test('the shared host switches Orbit between custom audio and a real browser microphone stream', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['microphone']);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as unknown as {
      captures: MediaStream[];
      captureRequests: number;
    };
    state.captures = [];
    state.captureRequests = 0;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      state.captureRequests++;
      const stream = await getUserMedia(constraints);
      state.captures.push(stream);
      return stream;
    };
  });
  await page.goto('/examples/orbit/');
  // Source controls stay in settings; the plugin has no extra toolbar.
  await expect(
    page.getByRole('radio', { name: 'Orbit', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Host settings', exact: true })
    .click();
  const input = page.getByLabel('Input', { exact: true });
  await expect(input).toHaveValue('orbit-demo');
  await expect(
    page.getByRole('option', { name: 'Pluck phrase · 120 BPM' }),
  ).toHaveCount(1);
  await input.selectOption('microphone');
  await expect(
    page.getByText('Press Play to use the microphone', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { captureRequests: number }).captureRequests,
    ),
  ).toBe(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(
    page.getByText('Microphone active', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { captures: MediaStream[] }
        ).captures[0]!.getAudioTracks()[0]!.readyState,
    ),
  ).toBe('live');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { captures: MediaStream[] }
        ).captures[0]!.getAudioTracks()[0]!.readyState,
    ),
  ).toBe('ended');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(
    page.getByText('Microphone active', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { captures: MediaStream[] }).captures.length,
    ),
  ).toBe(2);
  await input.selectOption('orbit-demo');
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { captures: MediaStream[] }
        ).captures[1]!.getAudioTracks()[0]!.readyState,
    ),
  ).toBe('ended');
  await expect(
    page.getByText('Microphone active', { exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('microphone permission denial is actionable and leaves other inputs usable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await page.goto('/examples/orbit/');
  await page
    .getByRole('button', { name: 'Host settings', exact: true })
    .click();
  await page.getByLabel('Input', { exact: true }).selectOption('microphone');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('permission was denied');
  await expect(page.getByRole('button', { name: 'Retry input' })).toBeVisible();
  await page.getByLabel('Input', { exact: true }).selectOption('orbit-demo');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Pause', exact: true }),
  ).toBeVisible();
});
