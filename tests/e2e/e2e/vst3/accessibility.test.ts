// The semantic tree assistive technology is given, which every platform's
// backend (AT-SPI, UI Automation, the Apple bridges) is made from: roles,
// names, values and states, kept up to date as the UI changes.
import { launchPlugin } from '@soundor/vitest-e2e';
import { expect, test } from 'vitest';

test('a slider is adjustable, with its range and the value it shows', async () => {
  const plugin = await launchPlugin();

  expect(
    await plugin.getByRole('adjustable', { name: 'Gain' }).getAccessibility(),
  ).toMatchObject({
    role: 'adjustable',
    focusable: true,
    value: { min: 0, max: 2, now: 1, text: '1.00x' },
  });
});

test('states follow the parameters they show', async () => {
  const plugin = await launchPlugin();
  const bypass = plugin.getByRole('togglebutton', { name: 'Bypass' });
  expect(await bypass.getAccessibility()).toMatchObject({
    states: { checked: 'false' },
  });

  await plugin.parameter('Bypass').set(1);
  await plugin.parameter('Mode').set(1);

  await expect
    .poll(async () => (await bypass.getAccessibility())['states'])
    .toMatchObject({ checked: 'true' });
  expect(
    await plugin.getByRole('radio', { name: 'Invert' }).getAccessibility(),
  ).toMatchObject({ states: { checked: 'true' } });
  expect(
    await plugin.getByRole('radio', { name: 'Clean' }).getAccessibility(),
  ).toMatchObject({ states: { checked: 'false' } });
});

test('groups, headers and labelled images are exposed, with their names', async () => {
  const plugin = await launchPlugin();

  await expect(plugin.getByRole('radiogroup', { name: 'Mode' })).toBeVisible();
  await expect(plugin.getByRole('header', { name: 'Rendering' })).toBeVisible();
  await expect(
    plugin.getByRole('header', { name: 'Soundor E2E' }),
  ).toBeVisible();
  expect(
    await plugin
      .getByRole('image', { name: 'Image swatch' })
      .getAccessibility(),
  ).toMatchObject({ exposed: true, focusable: false });
  expect(
    await plugin
      .getByRole('textinput', { name: 'Text to reverse' })
      .getAccessibility(),
  ).toMatchObject({ focusable: true });
});

test('focus shows in the tree', async () => {
  const plugin = await launchPlugin();
  const slider = plugin.getByRole('adjustable', { name: 'Gain' });

  await slider.focus();

  await expect
    .poll(async () => (await slider.getAccessibility())['focused'])
    .toBe(true);
});
