import { getTestRuntime } from '@soundor/test-runtime';
import { expect, test, vi } from 'vitest';

import { userEvent, fireEvent, advanceTime, waitFor } from '../index';
function input() {
  const r = getTestRuntime(),
    node = r.create('input');
  r.root.appendChild(node);
  return node;
}
test('modifiers, physical descriptors, literal delimiters and Unicode retain session state', async () => {
  const node = input(),
    user = userEvent.setup();
  node.focus();
  await user.keyboard('{Shift>}a{/Shift}[KeyB]{{[[🌐');
  expect(node.value).toBe('Ab{[🌐');
  expect(getTestRuntime().keys.size).toBe(0);
  await user.keyboard('{Control>}a{/Control}');
  expect(node.selectionStart).toBe(0);
  expect(node.selectionEnd).toBe(node.value.length);
  await user.keyboard('{Backspace}');
  expect(node.value).toBe('');
  await expect(user.keyboard('{Shift')).rejects.toThrow(
    'Unclosed keyboard descriptor',
  );
});
test('a knob locks its drag and turns by movement, as natively', async () => {
  const r = getTestRuntime(),
    knob = r.create('view'),
    elsewhere = r.create('view');
  r.root.appendChild(knob);
  r.root.appendChild(elsewhere);
  const turns: number[] = [];
  knob.addEventListener('pointerdown', () => void knob.requestPointerLock());
  knob.addEventListener('pointermove', (event) =>
    turns.push(event['movementY'] as number),
  );
  const user = userEvent.setup();
  await user.pointer({ target: knob, keys: '[MouseLeft>]' });
  expect(r.pointerLockNode()).toBe(knob);
  await user.pointer({ target: elsewhere, movementY: -30 });
  await user.pointer({ target: elsewhere, keys: '[/MouseLeft]' });
  expect(turns).toEqual([-30]);
  expect(r.pointerLockNode()).toBeNull();
});
test('capture lasts through the last mouse button and uses native bit masks', async () => {
  const r = getTestRuntime(),
    a = r.create('view'),
    b = r.create('view');
  r.root.appendChild(a);
  r.root.appendChild(b);
  const targets: unknown[] = [];
  a.addEventListener('pointermove', (event) => targets.push(event.target));
  const user = userEvent.setup();
  await user.pointer({ target: a, keys: '[MouseLeft>]' });
  await user.pointer({ target: b, keys: '[MouseMiddle>]' });
  expect(r.pointer.buttons).toBe(5);
  expect(r.pointer.down).toBe(a);
  await user.pointer({ target: b, keys: '[/MouseLeft]' });
  expect(r.pointer.buttons).toBe(4);
  expect(r.pointer.down).toBe(a);
  await user.pointer({ target: b });
  expect(targets.at(-1)).toBe(a);
  await user.pointer({ target: b, keys: '[/MouseMiddle]' });
  expect(r.pointer.down).toBeNull();
  expect(r.pointer.buttons).toBe(0);
});
test('release click goes to the deepest shared ancestor and hover follows capture', async () => {
  const r = getTestRuntime(),
    parent = r.create('view'),
    a = r.create('view'),
    b = r.create('view');
  parent.appendChild(a);
  parent.appendChild(b);
  r.root.appendChild(parent);
  const clicks: unknown[] = [];
  parent.addEventListener('click', (event) => clicks.push(event.target));
  const leave = vi.fn<() => void>();
  a.addEventListener('pointerleave', leave);
  const user = userEvent.setup();
  await user.pointer({ target: a, keys: '[MouseLeft>]' });
  await user.pointer({ target: b });
  expect(leave).not.toHaveBeenCalled();
  await user.pointer({ target: b, keys: '[/MouseLeft]' });
  expect(clicks).toEqual([parent]);
  expect(leave).toHaveBeenCalledTimes(1);
});
test('pointer cancellation and prevented text input follow native cancellation flags', async () => {
  const node = input(),
    r = getTestRuntime(),
    user = userEvent.setup();
  node.addEventListener('beforeinput', (event) => event.preventDefault());
  await user.type(node, 'abc');
  expect(node.value).toBe('');
  await user.pointer({ target: node, keys: '[MouseLeft>]' });
  let cancelable: unknown;
  node.addEventListener('pointercancel', (event) => {
    cancelable = event.cancelable;
    event.preventDefault();
    expect(event.defaultPrevented).toBe(false);
  });
  fireEvent.pointerCancel(node);
  expect(cancelable).toBe(false);
  expect(r.pointer.down).toBeNull();
});
test('long presses use the virtual clock and suppress regular activation', async () => {
  const r = getTestRuntime(),
    node = r.create('view');
  r.root.appendChild(node);
  const press = vi.fn<() => void>(),
    long = vi.fn<() => void>();
  r.pressable(node, { onPress: press, onLongPress: long, delayLongPress: 500 });
  const user = userEvent.setup();
  await user.pointer({ target: node, keys: '[MouseLeft>]' });
  await advanceTime(500);
  await user.pointer({ target: node, keys: '[/MouseLeft]' });
  expect(long).toHaveBeenCalledTimes(1);
  expect(press).not.toHaveBeenCalled();
});
test('hidden, detached and foreign controls never receive invalid user interactions', async () => {
  const node = input();
  node.style.display = 'none';
  const key = vi.fn<() => void>();
  node.addEventListener('keydown', key);
  const user = userEvent.setup();
  await user.type(node, 'a');
  expect(key).not.toHaveBeenCalled();
  node.style.display = undefined;
  node.remove();
  await expect(user.click(node)).rejects.toThrow('detached');
});
test('fake timers support delayed users through the standard Vitest advancer', async () => {
  vi.useFakeTimers();
  try {
    const node = input(),
      user = userEvent.setup({
        delay: 1,
        advanceTimers: vi.advanceTimersByTimeAsync,
      });
    await user.type(node, 'abc');
    expect(node.value).toBe('abc');
    const invalid = userEvent.setup({ delay: 1 });
    await expect(invalid.type(node, 'x')).rejects.toThrow('advanceTimers');
  } finally {
    vi.useRealTimers();
  }
});
test('waitFor retries with fake timers and reports bounded errors', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const result = await waitFor(
      () => {
        if (++calls < 3) throw new Error('not yet');
        return 7;
      },
      { timeout: 100, interval: 10 },
    );
    expect(result).toBe(7);
    await expect(
      waitFor(
        () => {
          throw new Error('still missing');
        },
        { timeout: 30, interval: 10 },
      ),
    ).rejects.toThrow('still missing');
  } finally {
    vi.useRealTimers();
  }
});
test('never-settling async assertions have a real deadline and invalid timeouts fail clearly', async () => {
  await expect(
    waitFor(() => new Promise(() => {}), { timeout: 10 }),
  ).rejects.toThrow('callback did not settle');
  await expect(waitFor(() => {}, { interval: 0 })).rejects.toThrow(
    'positive interval',
  );
  await expect(advanceTime(-1)).rejects.toThrow('nonnegative');
});

test('foreign nodes cannot mutate a session or the active runtime', async () => {
  const { createTestRuntime } = await import('@soundor/test-runtime');
  const foreign = createTestRuntime(),
    node = foreign.create('input');
  foreign.root.appendChild(node);
  const runtime = getTestRuntime(),
    user = userEvent.setup();
  await expect(user.click(node)).rejects.toThrow('another runtime');
  await expect(user.type(node, 'x')).rejects.toThrow('another runtime');
  expect(runtime.pointer).toEqual({
    down: null,
    target: null,
    buttons: 0,
    type: 'mouse',
    locked: null,
  });
  expect(foreign.pointer).toEqual({
    down: null,
    target: null,
    buttons: 0,
    type: 'mouse',
    locked: null,
  });
  expect(node.value).toBe('');
  foreign.dispose();
});

test('stale sessions reject interactions and held modifiers do not leak', async () => {
  const { resetTestContext } = await import('@soundor/test-runtime');
  const previousUser = userEvent.setup();
  await previousUser.keyboard('{Shift>}');
  expect(getTestRuntime().keys.has('Shift')).toBe(true);
  await resetTestContext();
  expect(getTestRuntime().keys.size).toBe(0);
  await expect(previousUser.keyboard('a')).rejects.toThrow('earlier test');
  expect(getTestRuntime().keys.size).toBe(0);
});
