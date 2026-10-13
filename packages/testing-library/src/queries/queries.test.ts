import { getTestRuntime } from '@soundor/test-runtime';
import { expect, test } from 'vitest';

import { screen, within, fireEvent, userEvent } from '../index';
function text(value: string) {
  const r = getTestRuntime(),
    node = r.create('text');
  node.text = value;
  return node;
}
test('queries native roles, names, descriptions, states and values', () => {
  const r = getTestRuntime();
  const node = r.create('view');
  node.accessibility = {
    role: 'adjustable',
    label: 'Gain',
    hint: 'Output level',
    state: { disabled: false },
    value: { min: 0, max: 10, now: 5, text: '5 dB' },
  };
  r.root.appendChild(node);
  expect(
    screen.getByRole('adjustable', {
      name: /gain/i,
      description: 'Output level',
      disabled: false,
      value: { now: 5, text: /dB/ },
    }),
  ).toBe(node);
  expect(screen.queryByRole('button')).toBeNull();
  expect(() => screen.getByRole('button')).toThrow('adjustable "Gain"');
});
test('nested text names follow collapsed semantics and physical text remains queryable', () => {
  const r = getTestRuntime(),
    button = r.create('view');
  button.accessibility = { role: 'button' };
  button.appendChild(text('Save'));
  r.root.appendChild(button);
  expect(screen.getByRole('button', { name: 'Save' })).toBe(button);
  expect(screen.queryByRole('text')).toBeNull();
  expect(screen.getByText('Save').text).toBe('Save');
});
test('zero, multiple, regex and text normalization matches are consistent', () => {
  const r = getTestRuntime();
  r.root.appendChild(text('  A\n B '));
  r.root.appendChild(text('A B'));
  expect(screen.getAllByText('A B')).toHaveLength(2);
  expect(screen.queryAllByText(/A B/g)).toHaveLength(2);
  expect(() => screen.queryByText('A B')).toThrow('Found 2 elements');
  expect(screen.queryByText('missing')).toBeNull();
});
test('modal visibility, hidden queries and logical portal ownership agree', () => {
  const r = getTestRuntime(),
    background = r.create('input'),
    modal = r.create('view'),
    portal = r.create('input');
  background.accessibility = { label: 'Background' };
  modal.accessibility = { modal: true };
  portal.accessibility = { label: 'Portal' };
  portal.accessibilityParent = modal;
  r.root.appendChild(background);
  r.overlayRoot.appendChild(modal);
  r.overlayRoot.appendChild(portal);
  expect(screen.queryByLabelText('Background')).toBeNull();
  expect(screen.getByLabelText('Background', { hidden: true })).toBe(
    background,
  );
  expect(within(modal).getByRole('textinput', { name: 'Portal' })).toBe(portal);
  modal.remove();
  expect(screen.getByLabelText('Background')).toBe(background);
});
test('the root entry uses native event dispatch without React', async () => {
  const r = getTestRuntime(),
    input = r.create('input');
  input.accessibility = { label: 'Input' };
  r.root.appendChild(input);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Input'), 'a{}');
  expect(input.value).toBe('a{}');
  fireEvent.keyDown(input, { key: 'Home' });
  expect(input.selectionStart).toBe(0);
});

test('hidden descendants do not contaminate visible text and input text is queryable', () => {
  const runtime = getTestRuntime(),
    view = runtime.create('view'),
    hidden = text('Secret');
  hidden.style.display = 'none';
  view.appendChild(text('Visible'));
  view.appendChild(hidden);
  runtime.root.appendChild(view);
  expect(screen.getByText('Visible')).toBe(view.children[0]);
  expect(screen.queryByText('Visible Secret')).toBeNull();
  expect(screen.getByText('Visible Secret', { hidden: true })).toBe(view);
  const input = runtime.create('input');
  input.placeholder = 'Enter name';
  runtime.root.appendChild(input);
  expect(screen.getByText('Enter name')).toBe(input);
  input.value = 'Soundor';
  expect(screen.getByText('Soundor')).toBe(input);
});
