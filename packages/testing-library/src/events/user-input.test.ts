import { getTestRuntime, type TestEvent } from '@soundor/test-runtime';
import { expect, test, vi } from 'vitest';

import { fireEvent, userEvent } from '../index';

test('wheel hovers first, dispatches held modifiers and scrolls without changing focus modality', async () => {
  const r = getTestRuntime();
  const outer = r.create('view', { overflowX: 'scroll' });
  const inner = r.create('view', { overflowY: 'scroll' });
  const node = r.create('view');
  r.root.appendChild(outer);
  outer.appendChild(inner);
  inner.appendChild(node);
  node.focusable = true;
  const seen: unknown[] = [];
  node.addEventListener('pointerenter', () => seen.push('enter'));
  node.addEventListener('wheel', (event) =>
    seen.push([
      event['deltaX'],
      event['deltaY'],
      event['deltaMode'],
      event['shiftKey'],
    ]),
  );
  outer.addEventListener('scroll', () => seen.push('scroll'));
  const user = userEvent.setup();
  await user.keyboard('{Shift>}');
  await user.wheel(node, { deltaY: 2, deltaMode: 1 });
  expect(seen).toEqual(['enter', [0, 2, 1, true], 'scroll']);
  expect(outer.scrollLeft).toBe(80);
  expect(inner.scrollTop).toBe(0);
  node.focus();
  expect(node.focusVisible).toBe(true);

  await user.keyboard('{/Shift}{Control>}');
  await user.wheel(node, { deltaY: 5 });
  expect(inner.scrollTop).toBe(0);
  await user.keyboard('{/Control}');
  node.addEventListener('wheel', (event) => event.preventDefault(), {
    once: true,
  });
  await user.wheel(node, { deltaY: 5 });
  expect(inner.scrollTop).toBe(0);
  await user.wheel(node, { deltaY: 5 });
  expect(inner.scrollTop).toBe(5);
});

test('wheel, pen and touch skip hidden or disabled targets', async () => {
  const r = getTestRuntime();
  const hidden = r.create('view', { display: 'none' });
  const disabled = r.create('view');
  disabled.accessibility = { state: { disabled: true } };
  r.root.appendChild(hidden);
  r.root.appendChild(disabled);
  const listener = vi.fn<() => void>();
  const user = userEvent.setup();
  for (const node of [hidden, disabled]) {
    for (const type of ['pointerenter', 'pointerdown', 'wheel'])
      node.addEventListener(type, listener);
    await user.wheel(node, { deltaY: 10 });
    await user.pointer({
      target: node,
      keys: '[MouseLeft]',
      pointerType: 'pen',
    });
    await user.pointer({ target: node, keys: '[TouchA]' });
  }
  expect(listener).not.toHaveBeenCalled();
});

test('two touches keep independent capture, primary status and button state', async () => {
  const r = getTestRuntime();
  const a = r.create('view');
  const b = r.create('view');
  const hover = vi.fn<() => void>();
  const seen: unknown[] = [];
  const ids: number[] = [];
  let lock: Promise<void> | undefined;
  a.addEventListener('pointerdown', () => {
    lock = a.requestPointerLock();
    void lock.catch(() => {});
  });
  for (const [label, node] of [
    ['a', a],
    ['b', b],
  ] as const) {
    r.root.appendChild(node);
    node.addEventListener('pointerenter', hover);
    node.addEventListener('pointerleave', hover);
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
    ]) {
      node.addEventListener(type, (event) => {
        if (type === 'pointerdown') ids.push(event.pointerId as number);
        seen.push([
          label,
          type,
          event.pointerId,
          event.pointerType,
          event.buttons,
          event['isPrimary'],
        ]);
      });
    }
  }
  const user = userEvent.setup();
  await user.pointer([
    { target: a, keys: '[TouchA>]' },
    { target: b, keys: '[TouchB>]' },
    { target: b, pointerName: 'TouchA', clientX: 25 },
    { keys: '[/TouchA]' },
    { target: a, pointerName: 'TouchB', clientX: 10 },
  ]);
  const [first, second] = ids;
  expect(first).not.toBe(second);
  expect(first).not.toBe(0);
  expect(seen).toEqual([
    ['a', 'pointerdown', first, 'touch', 1, true],
    ['b', 'pointerdown', second, 'touch', 1, false],
    ['a', 'pointermove', first, 'touch', 1, true],
    ['a', 'pointerup', first, 'touch', 0, true],
    ['b', 'pointermove', second, 'touch', 1, false],
  ]);
  expect(hover).not.toHaveBeenCalled();
  await expect(lock).rejects.toMatchObject({ name: 'NotAllowedError' });
  fireEvent.pointerCancel(b, { pointerId: second });
  expect(seen.at(-1)).toEqual([
    'b',
    'pointercancel',
    second,
    'touch',
    0,
    false,
  ]);
  await expect(user.pointer({ keys: '[/TouchB]' })).rejects.toThrow('not held');
});

test('a pen has its own hover and capture and can lock without ending a mouse press', async () => {
  const r = getTestRuntime();
  const mouse = r.create('view');
  const pen = r.create('view');
  r.root.appendChild(mouse);
  r.root.appendChild(pen);
  const penMove = vi.fn<(event: TestEvent) => void>();
  const penEnter = vi.fn<(event: TestEvent) => void>();
  pen.addEventListener('pointerenter', penEnter);
  pen.addEventListener('pointermove', penMove);
  const user = userEvent.setup();
  await user.pointer({ target: mouse, keys: '[MouseLeft>]' });
  await user.pointer({
    target: pen,
    keys: '[MouseLeft>]',
    pointerType: 'pen',
    pressure: 0.5,
  });
  expect(penEnter).toHaveBeenCalledWith(
    expect.objectContaining({ pointerType: 'pen' }),
  );
  await expect(pen.requestPointerLock()).resolves.toBeUndefined();
  await user.pointer({ target: mouse, pointerType: 'pen', pressure: 0.7 });
  expect(penMove).toHaveBeenCalledWith(
    expect.objectContaining({ pointerType: 'pen', pressure: 0.7, buttons: 1 }),
  );
  await user.pointer({ keys: '[/MouseLeft]', pointerType: 'pen' });
  expect(r.pointerLockNode()).toBeNull();
  expect(r.pointer.down).toBe(mouse);
  await user.pointer({ keys: '[/MouseLeft]' });
});

test('screen-reader actions require a visible semantic element and an offered action', async () => {
  const r = getTestRuntime();
  const slider = r.create('view');
  const child = r.create('view');
  r.root.appendChild(slider);
  slider.appendChild(child);
  slider.focusable = true;
  slider.accessibility = {
    role: 'adjustable',
    actions: [{ name: 'setValue' }, { name: 'blur' }],
  };
  child.accessibility = { role: 'button', actions: [{ name: 'activate' }] };
  const seen = vi.fn<(event: TestEvent) => void>();
  slider.addEventListener('accessibilityaction', seen);
  const user = userEvent.setup();
  await user.accessibilityAction(slider, 'setValue', 0.75);
  expect(seen).toHaveBeenCalledWith(
    expect.objectContaining({ actionName: 'setValue', value: 0.75 }),
  );
  await expect(user.accessibilityAction(slider, 'increment')).rejects.toThrow(
    'does not offer',
  );
  await expect(user.accessibilityAction(child, 'activate')).rejects.toThrow(
    'not exposed',
  );
  slider.style.display = 'none';
  await expect(user.accessibilityAction(slider, 'setValue')).rejects.toThrow(
    'not exposed',
  );
  slider.style.display = undefined;
  slider.accessibility = { ...slider.accessibility, state: { disabled: true } };
  await expect(user.accessibilityAction(slider, 'setValue')).rejects.toThrow(
    'Disabled',
  );
  expect(seen).toHaveBeenCalledTimes(1);
  await user.click(r.root); // Switch the simulator to pointer modality.
  await user.accessibilityAction(slider, 'focus');
  expect(slider.focusVisible).toBe(true);
  await user.accessibilityAction(slider, 'blur');
  expect(slider.focused).toBe(false);
});
