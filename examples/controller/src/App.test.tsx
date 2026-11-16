import {
  mockNative,
  render,
  screen,
  userEvent,
  waitFor,
} from '@soundor/testing-library/react';
import { state } from 'soundor:state';
import { expect, test, vi } from 'vitest';

import { App } from './App';

// The Rust controller's methods, mocked as the UI sees them: synchronous
// ones return their value, async ones a promise (native/tests/controller.rs
// tests the controller itself).
function mockController() {
  let clicks = 0;
  let loads = 0n;
  mockNative('click', () => ++clicks);
  mockNative(
    'clickLater',
    vi.fn(async () => ++clicks),
  );
  mockNative('stats', () => ({ clicks, loads, lastShape: null }));
  mockNative(
    'loadTable',
    vi.fn(async (shape: string, size: number) => {
      loads += 1n;
      state.shape.set(shape as never);
      return size;
    }),
  );
}

test('counts clicks synchronously and later', async () => {
  mockController();
  await render(<App />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Click' }));
  expect(screen.getByText('1 clicks')).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Click later' }));
  await waitFor(() => expect(screen.getByText('2 clicks')).toBeDefined());
});

test('loads a wavetable and shows its shape', async () => {
  mockController();
  await render(<App />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'saw' }));
  await waitFor(() =>
    expect(
      screen.getByText('saw: 2048 samples · 1 loads, last none'),
    ).toBeDefined(),
  );
  expect(screen.getByText('Rate 30.0 Hz · saw')).toBeDefined();
});

test('shows a load that failed', async () => {
  mockController();
  mockNative('loadTable', async () => {
    throw new Error(
      'loadTable(): the control thread did not record the table in time',
    );
  });
  await render(<App />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'sine' }));
  await waitFor(() =>
    expect(
      screen.getByText(
        'Error: loadTable(): the control thread did not record the table in time',
      ),
    ).toBeDefined(),
  );
});
