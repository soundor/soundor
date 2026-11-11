import { Text, useStateValue } from '@soundor/react';
import { createTestRuntime } from '@soundor/test-runtime';
import { act, render, screen } from '@soundor/testing-library/react';
import { expect, it } from 'vitest';

it('hooks keep returning values while field updaters read each latest write', async () => {
  const runtime = createTestRuntime({
    state: {
      types: [],
      fields: [
        {
          name: 'count',
          type: { kind: 'primitive', name: 'int32' },
          default: 0,
        },
      ],
    },
  });
  const field = runtime.state.fields.count!;
  function Example() {
    const count = useStateValue(field);
    return <Text>{String(count)}</Text>;
  }
  const view = await render(<Example />);
  expect(screen.getByText('0')).toBeTruthy();
  await act(() => {
    field.set((current: unknown) => Number(current) + 1);
    field.set((current: unknown) => Number(current) + 1);
  });
  expect(screen.getByText('2')).toBeTruthy();
  expect(runtime.state.gestureDepth('count')).toBe(0);
  await view.unmount();
  runtime.dispose();
});
