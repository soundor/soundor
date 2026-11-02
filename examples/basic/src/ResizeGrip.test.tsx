import {
  act,
  fireEvent,
  render,
  screen,
  testEditor,
  userEvent,
} from '@soundor/testing-library/react';
import { editorSize } from 'soundor:ui';
import { expect, test } from 'vitest';

import { ResizeGrip } from './ResizeGrip';

// soundor.config: 800×600, resizable within 480×400 – 1600×1200.

/** The microtask in which the simulated host gives the size asked for. */
const answered = () => act(() => Promise.resolve());

test('a drag asks for the size at the press plus how far the pointer went', async () => {
  await render(<ResizeGrip />);
  const grip = screen.getByRole('button', { name: 'Resize the editor' });
  fireEvent.pointerDown(grip, {
    button: 0,
    buttons: 1,
    screenX: 1000,
    screenY: 700,
  });
  fireEvent.pointerMove(grip, { buttons: 1, screenX: 1100, screenY: 750 });
  await answered();
  expect(editorSize()).toMatchObject({ width: 900, height: 650 });
  // The editor grew under the pointer: from the press still, not from 900.
  fireEvent.pointerMove(grip, { buttons: 1, screenX: 1150, screenY: 760 });
  // Far beyond the limits: held to them.
  fireEvent.pointerMove(grip, { buttons: 1, screenX: 9000, screenY: 9000 });
  fireEvent.pointerUp(grip, { button: 0 });
  await answered();
  expect(testEditor.requests()).toEqual([
    { width: 900, height: 650 },
    { width: 950, height: 660 },
    { width: 1600, height: 1200 },
  ]);
  expect(editorSize()).toMatchObject({ width: 1600, height: 1200 });
  // Released: moving asks nothing.
  fireEvent.pointerMove(grip, { screenX: 100, screenY: 100 });
  expect(testEditor.requests()).toHaveLength(3);
});

test('a cancelled drag asks for the size it began at', async () => {
  await render(<ResizeGrip />);
  const grip = screen.getByRole('button', { name: 'Resize the editor' });
  fireEvent.pointerDown(grip, {
    button: 0,
    buttons: 1,
    screenX: 0,
    screenY: 0,
  });
  fireEvent.pointerMove(grip, { buttons: 1, screenX: 200, screenY: 100 });
  fireEvent.pointerCancel(grip);
  await answered();
  expect(editorSize()).toMatchObject({ width: 800, height: 600 });
});

test('the arrow keys resize it, ten pixels a press, fifty with Shift', async () => {
  await render(<ResizeGrip />);
  const user = userEvent.setup();
  await user.tab();
  expect(
    screen.getByRole('button', { name: 'Resize the editor' }),
  ).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  await answered();
  await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
  await answered();
  expect(editorSize()).toMatchObject({ width: 810, height: 650 });
});

test('it hides where the editor cannot be asked for another size', async () => {
  await render(<ResizeGrip />);
  await testEditor.resize({ resizable: false });
  expect(
    screen.queryByRole('button', { name: 'Resize the editor' }),
  ).toBeNull();
});
