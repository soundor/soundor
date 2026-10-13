import {
  render,
  screen,
  userEvent,
  fireEvent,
  advanceTime,
  within,
} from '@soundor/testing-library/react';
import { getTestRuntime } from '@soundor/vitest';
import { expect, test } from 'vitest';

import { App } from './App';

test('pointer, keyboard and accessibility actions update the same adjustable value', async () => {
  await render(<App />);
  const user = userEvent.setup(),
    knob = screen.getByRole('adjustable', { name: 'Gain' });
  await user.pointer({ target: knob, keys: '[MouseLeft>]', clientY: 40 });
  await user.pointer({ target: knob, clientY: 32 });
  await user.pointer({ target: knob, keys: '[/MouseLeft]', clientY: 32 });
  expect(
    screen.getByRole('adjustable', { name: 'Gain', value: { now: -1.5 } }),
  ).toBe(knob);
  await user.keyboard('{ArrowUp}');
  expect(screen.getByText('Gain: -1.0 dB')).toBeDefined();
  fireEvent.accessibilityAction(knob, { actionName: 'reset' });
  expect(
    screen.getByRole('adjustable', { value: { now: 0, text: '0.0 dB' } }),
  ).toBe(knob);
});
test('nested dialogs hide the background, trap focus, and restore the outer dialog', async () => {
  await render(<App />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Open dialog' }));
  const outer = screen.getByRole('dialog', { name: 'Preset settings' }),
    input = within(outer).getByRole('textinput');
  await user.type(input, 'Warm');
  await user.tab();
  await user.tab();
  expect(getTestRuntime().focusedNode()).toBe(
    within(outer).getByRole('button', { name: 'Open a nested dialog' }),
  );
  await user.keyboard('{Enter}');
  expect(screen.queryByRole('dialog', { name: 'Preset settings' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Are you sure?' })).toBeDefined();
  await user.tab();
  expect(getTestRuntime().focusedNode()).toBe(
    screen.getByRole('button', { name: 'Close' }),
  );
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Are you sure?' })).toBeNull();
  expect(
    within(screen.getByRole('dialog', { name: 'Preset settings' })).getByRole(
      'textinput',
    ).value,
  ).toBe('Warm');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(getTestRuntime().focusedNode()).toBe(
    screen.getByRole('button', { name: 'Open dialog' }),
  );
});
test('custom portal host content follows toggle state', async () => {
  await render(<App />);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: 'Render into the host' }),
  );
  expect(screen.getByText('Hosted (clipped by its frame)')).toBeDefined();
  await user.click(
    screen.getByRole('button', { name: 'Remove hosted content' }),
  );
  expect(screen.queryByText('Hosted (clipped by its frame)')).toBeNull();
});
test('timing and repeating paint animations progress and cancel on unmount', async () => {
  const result = await render(<App />),
    user = userEvent.setup();
  const panel = screen.getByLabelText('Animated panel'),
    paint = screen.getByLabelText('Repeating paint');
  const repeating = paint.animations[0]!;
  await user.click(screen.getByRole('button', { name: 'Toggle animation' }));
  const timing = panel.animations[0]!;
  expect(panel.presentation.opacity).toBe(0.5);
  await advanceTime(125);
  expect(Number(panel.presentation.opacity)).toBeGreaterThan(0.5);
  await advanceTime(125);
  await timing.finished;
  expect(panel.presentation.opacity).toBe(1);
  const initial = paint.presentation.backgroundColor;
  await advanceTime(250);
  expect(paint.presentation.backgroundColor).not.toBe(initial);
  expect(repeating.playState).toBe('running');
  await result.unmount();
  expect(repeating.playState).toBe('idle');
  expect(getTestRuntime().activeAnimations.size).toBe(0);
});
