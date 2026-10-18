import { node, startSimulatedRuntime } from '@soundor/devtools-server/testing';
import { expect, it } from 'vitest';

import { page, setup, until } from './helpers';

it('clicks, hovers and focuses the selected node from any tab', async () => {
  const { server, native, page: tab } = await setup();
  await tab.ready();
  await tab.select('3');
  const button = (id: string) => tab.get(id) as unknown as HTMLButtonElement;
  await until(() => !button('node-click').disabled);
  tab.click('node-click');
  await until(() => native.inputLog.includes('click:3'));
  expect(native.inputLog).toEqual(['pointerdown:3', 'pointerup:3', 'click:3']);
  await until(() => tab.text('interaction') === 'Clicked');
  await until(() => !button('node-hover').disabled);
  tab.click('node-hover');
  await until(() => native.inputLog.includes('pointermove:3'));
  // Not focusable: the fixture says nothing of it.
  expect(button('node-focus').disabled).toBe(true);
  // Another tab clicks too, with its own pointer.
  const other = await page(server);
  await other.ready();
  await other.select('3');
  await until(
    () => !(other.get('node-click') as unknown as HTMLButtonElement).disabled,
  );
  other.click('node-click');
  await until(
    () => native.inputLog.filter((entry) => entry === 'click:3').length === 2,
  );
});

it('focuses focusable nodes and sends nothing to a covered node', async () => {
  const { native, page: tab } = await setup();
  native.setNodes([
    node('1', null, ['2', '3']),
    node('2', '1', [], {
      debugId: 'field',
      properties: { focusable: true },
      bounds: { x: 0, y: 0, width: 40, height: 20 },
    }),
    // Drawn over the field.
    node('3', '1', [], { bounds: { x: 0, y: 0, width: 100, height: 100 } }),
  ]);
  await tab.ready();
  await tab.select('2');
  await until(
    () => !(tab.get('node-focus') as unknown as HTMLButtonElement).disabled,
  );
  tab.click('node-focus');
  await until(() => tab.text('interaction') === 'Focused');
  expect(native.inputLog).toEqual(['focus:2']);
  tab.click('node-click');
  await until(() => tab.text('notice').includes('is covered'));
  expect(tab.text('notice')).toContain('nothing was sent');
  expect(native.inputLog).toEqual(['focus:2']);
});

it('shows no input actions for a target without input', async () => {
  const { server, native, page: tab } = await setup();
  await native.close();
  const limited = await startSimulatedRuntime({
    connection: server.connection,
    input: false,
  });
  try {
    await until(() => tab.text('target-meta').includes('inspector'));
    await tab.ready();
    await tab.select('3');
    expect(tab.text('node-actions')).toContain('does not accept input');
    expect(tab.get('node-click')).toBeNull();
  } finally {
    await limited.close();
  }
});
