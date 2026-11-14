import { Text, useHistory, useStateValue } from '@soundor/react';
import { getTestRuntime } from '@soundor/test-runtime';
import { act, render, screen } from '@soundor/testing-library/react';
import { expect, it } from 'vitest';
it('reacts to commits and replay through the application manager without polling', async () => {
  const field = getTestRuntime().state.fields.historyCounter!;
  let actions: ReturnType<typeof useHistory>;
  function Example() {
    actions = useHistory();
    const value = useStateValue(field);
    return (
      <Text>{`${value}: ${actions.canUndo ? actions.undoLabel : 'Empty'}`}</Text>
    );
  }
  await render(<Example />);
  expect(screen.getByText('0: Empty')).toBeTruthy();
  await act(() => field.set(1, { history: { label: 'Increment' } }));
  expect(screen.getByText('1: Increment')).toBeTruthy();
  const undo = actions!.undo;
  await act(() => actions!.undo());
  expect(screen.getByText('0: Empty')).toBeTruthy();
  expect(actions!.canRedo).toBe(true);
  await act(() => actions!.redo());
  expect(screen.getByText('1: Increment')).toBeTruthy();
  expect(actions!.undo).toBe(undo);
});
