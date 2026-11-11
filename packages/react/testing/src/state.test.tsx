import { useStateValue, Text } from '@soundor/react';
import { render, screen, act } from '@soundor/testing-library/react';
import { expect, it } from 'vitest';

it('subscribes to one stable state snapshot and refreshes nullable and structured values', async () => {
  let value: { name: string } | null = null;
  const listeners = new Set<(value: { name: string } | null) => void>();
  const field = {
    get: () => value,
    subscribe: (fn: (value: { name: string } | null) => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  let renders = 0;
  function Example() {
    const selected = useStateValue(field);
    renders++;
    return <Text>{selected?.name ?? 'None'}</Text>;
  }
  const view = await render(<Example />);
  expect(screen.getByText('None')).toBeTruthy();
  await act(() => {
    value = Object.freeze({ name: 'Warm' });
    listeners.forEach((fn) => fn(value));
  });
  expect(screen.getByText('Warm')).toBeTruthy();
  const before = renders;
  await act(() => {
    listeners.forEach((fn) => fn(value));
  });
  expect(renders).toBe(before);
  await view.unmount();
  expect(listeners.size).toBe(0);
  await render(<Example />);
  expect(screen.getByText('Warm')).toBeTruthy();
});
