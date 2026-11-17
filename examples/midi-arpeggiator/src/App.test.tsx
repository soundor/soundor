import { getTestRuntime } from '@soundor/test-runtime';
import { render, screen, userEvent } from '@soundor/testing-library/react';
import { expect, test } from 'vitest';

import { App } from './App';

test('panic requests all sound off on every channel', async () => {
  const runtime = getTestRuntime();
  await render(<App />);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'All notes off' }));
  expect(runtime.takeMidiMessages()).toEqual(
    Array.from({ length: 16 }, (_, index) => ({
      type: 'controlChange',
      channel: index + 1,
      controller: 120,
      value: 0,
    })),
  );
});
