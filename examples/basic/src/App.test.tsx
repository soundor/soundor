import {
  render,
  screen,
  userEvent,
  act,
  waitFor,
} from '@soundor/testing-library/react';
import { getTestRuntime } from '@soundor/vitest';
import { parameters } from 'soundor:parameters';
import { storage } from 'soundor:storage';
import { expect, test, vi } from 'vitest';

import { App } from './App';

test('changes gain, edits and saves a preset, then navigates to reset in one session', async () => {
  const runtime = getTestRuntime(),
    changed = vi.fn<(value: number) => void>();
  parameters.gain.subscribe(changed);
  await storage.set('presetName', 'Init');
  await render(<App />);
  const user = userEvent.setup();
  await user.tab(); // The application's first focusable control is the gain fader.
  await user.keyboard('{ArrowUp}{Shift>}{ArrowUp}{/Shift}');
  expect(parameters.gain.get()).toBeCloseTo(0.61);
  expect(screen.getByText('0.61')).toBeDefined();
  await user.tab();
  const input = screen.getByRole('textinput');
  expect(runtime.focusedNode()).toBe(input);
  await user.clear(input);
  await user.type(input, 'Warm');
  await user.keyboard('{Enter}');
  await waitFor(async () =>
    expect(await storage.get('presetName')).toBe('Warm'),
  );
  await user.tab();
  expect(runtime.focusedNode()).toBe(
    screen.getByRole('button', { name: 'Reset gain' }),
  );
  await user.keyboard('{Enter}');
  expect(parameters.gain.get()).toBe(0.5);
  expect(changed).toHaveBeenLastCalledWith(0.5);
  expect(screen.getByText('0.50')).toBeDefined();
  expect(runtime.keys.size).toBe(0);
  expect(runtime.pointer.down).toBeNull();
});
test('host and parameter subscriptions update the real application', async () => {
  await render(<App />);
  await act(() => {
    getTestRuntime().setHost({ hostName: 'Test DAW', sampleRate: 96000 });
    parameters.gain.set(0.75);
  });
  expect(screen.getByText(/Test DAW · 96000 Hz/)).toBeDefined();
  expect(screen.getByText('0.75')).toBeDefined();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Reset gain' }));
  expect(parameters.gain.get()).toBe(0.5);
});
test('loads a stored preset into the controlled input', async () => {
  await storage.set('presetName', 'Bright');
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByRole('textinput').value).toBe('Bright'),
  );
});
