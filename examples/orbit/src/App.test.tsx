import {
  render,
  screen,
  userEvent,
  testParameters,
  waitFor,
} from '@soundor/testing-library/react';
import { history } from 'soundor:history';
import { parameters } from 'soundor:parameters';
import { presets } from 'soundor:presets';
import { state } from 'soundor:state';
import { expect, test } from 'vitest';

import { App } from './App';

test('presets set the real parameters, release Hold, and survive host automation', async () => {
  await render(<App />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('togglebutton', { name: 'Hold' }));
  expect(parameters.hold.get()).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Next preset' }));
  expect(parameters.hold.get()).toBe(false);
  // float32 parameters hold 32-bit floats.
  expect(parameters.time1.get()).toBe(Math.fround(0.38));
  expect(parameters.sync.get()).toBe(false);
  expect(screen.getByText('Warm magnetic')).toBeDefined();
  testParameters.set('mix', 0.7);
  expect(
    screen.getByRole('adjustable', { name: 'Mix' }).accessibility.value?.now,
  ).toBe(Math.fround(0.7));
});

test('preset loading is one undoable edit including Hold, selection and description', async () => {
  await render(<App />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('togglebutton', { name: 'Hold' }));
  await user.click(screen.getByRole('button', { name: 'Next preset' }));
  expect(history.undoLabel()).toBe('Load Warm magnetic');
  expect(presets.getSnapshot()).toEqual({
    factoryId: 'warm-magnetic',
    modified: false,
  });
  expect(state.presetDescription.get()).toBe(
    'Short, dark repeats with a little tape drift.',
  );

  history.undo();
  await waitFor(() =>
    expect(screen.getByText('Dotted satellites')).toBeDefined(),
  );
  expect(parameters.hold.get()).toBe(true);
  expect(parameters.time1.get()).toBe(0.75);
  expect(state.presetDescription.get()).toBe(
    'Listen for the repeats between phrases.',
  );
  expect(history.undoLabel()).toBe('Change Hold');

  history.redo();
  await waitFor(() => expect(screen.getByText('Warm magnetic')).toBeDefined());
  expect(parameters.hold.get()).toBe(false);
  expect(parameters.time1.get()).toBe(Math.fround(0.38));
  expect(state.presetDescription.get()).toBe(
    'Short, dark repeats with a little tape drift.',
  );
});

test('external preset selection drives navigation and survives remounting the editor', async () => {
  const app = await render(<App />);
  presets.factory.load('drifting-space');
  await waitFor(() => expect(screen.getByText('Drifting space')).toBeDefined());
  expect(screen.getByText('Long, moving tails fill the gaps.')).toBeDefined();
  testParameters.set('mix', 0.2);
  await waitFor(() => expect(screen.getByText('PRESET / 03 *')).toBeDefined());

  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Next preset' }));
  expect(presets.getSnapshot()).toEqual({
    factoryId: 'close-conversation',
    modified: false,
  });
  await app.unmount();
  await render(<App />);
  expect(screen.getByText('Close conversation')).toBeDefined();
  expect(
    screen.getByText('A tight, wide double instead of a long tail.'),
  ).toBeDefined();
});

test('echoes and knobs support keyboard editing; toggles expose their state', async () => {
  await render(<App />);
  const user = userEvent.setup();
  screen.getByRole('adjustable', { name: 'Echo 1 time' }).focus();
  await user.keyboard('{ArrowRight}{ArrowDown}');
  expect(parameters.time1.get()).toBe(0.875);
  expect(parameters.level1.get()).toBeCloseTo(0.75);
  screen.getByRole('adjustable', { name: 'Feedback' }).focus();
  await user.keyboard('{ArrowUp}');
  expect(parameters.feedback.get()).toBeGreaterThan(0.48);
  await user.keyboard('{Home}');
  expect(parameters.feedback.get()).toBe(Math.fround(0.48));
  await user.click(screen.getByRole('radio', { name: 'Original' }));
  expect(parameters.bypass.get()).toBe(true);
  expect(
    screen.getByRole('radio', { name: 'Original' }).accessibility.state
      ?.checked,
  ).toBe(true);
  const mix = parameters.mix.get();
  await user.click(screen.getByRole('radio', { name: 'Orbit' }));
  expect(parameters.bypass.get()).toBe(false);
  expect(parameters.mix.get()).toBe(mix);
});
