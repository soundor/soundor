import { getTestRuntime } from '@soundor/test-runtime';
import {
  act,
  fireEvent,
  mockNative,
  render,
  screen,
  userEvent,
} from '@soundor/testing-library/react';
import { expect, test } from 'vitest';

import { App } from './App';

test('piano press/release reaches MIDI and controller stats are explicit', async () => {
  const runtime = getTestRuntime();
  mockNative('stats', () => ({ events: 23, resets: 1 }));
  mockNative('playNote', () => true);
  await render(<App />);
  const key = screen.getByRole('button', { name: 'Note 60' });
  fireEvent.pointerDown(key);
  fireEvent.pointerUp(key);
  expect(runtime.takeMidiMessages()).toEqual([
    { type: 'noteOn', channel: 1, note: 60, velocity: 100 },
    { type: 'noteOff', channel: 1, note: 60, velocity: 0 },
  ]);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Read controller monitor' }));
  expect(screen.getByText('Controller: 23 events · 1 resets')).toBeDefined();
});

test('unmount releases a held note and removes the observer', async () => {
  const runtime = getTestRuntime();
  const view = await render(<App />);
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Note 64' }));
  await view.unmount();
  expect(runtime.takeMidiMessages().at(-1)).toEqual({
    type: 'noteOff',
    channel: 1,
    note: 64,
    velocity: 0,
  });
});

test('monitor clears discontinuous history and reports dropped events', async () => {
  const runtime = getTestRuntime();
  await render(<App />);
  await act(() =>
    runtime.emitMidi([
      {
        message: { type: 'noteOn', channel: 16, note: 60, velocity: 100 },
        sampleOffset: 37,
        source: 'host',
      },
    ]),
  );
  expect(screen.getByText(/"channel":16.*\+37/)).toBeDefined();
  await act(() => runtime.emitMidi([], true, 7));
  expect(screen.getByText(/Reset · 7 dropped/)).toBeDefined();
  expect(screen.queryByText(/"channel":16.*\+37/)).toBeNull();
});
