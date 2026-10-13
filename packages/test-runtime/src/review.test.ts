import { describe, expect, it } from 'vitest';

import { createTestRuntime, TestEvent } from './index';

describe('pointer ownership preconditions', () => {
  it('rejects a foreign pointer down without changing either runtime', () => {
    const a = createTestRuntime(),
      b = createTestRuntime(),
      foreign = b.create('view');
    const beforeA = { ...a.pointer },
      beforeB = { ...b.pointer };
    expect(() => a.pointerDown(foreign)).toThrow('another runtime');
    expect(a.pointer).toEqual(beforeA);
    expect(b.pointer).toEqual(beforeB);
    a.dispose();
    b.dispose();
  });
  it.each(['pointerDown', 'pointerMove', 'pointerUp'] as const)(
    '%s rejects foreign hit targets while a valid capture exists',
    (operation) => {
      const a = createTestRuntime(),
        b = createTestRuntime(),
        own = a.create('view'),
        foreign = b.create('view');
      a.root.appendChild(own);
      a.pointerDown(own);
      const beforeA = { ...a.pointer },
        beforeB = { ...b.pointer };
      expect(() => a[operation](foreign)).toThrow('another runtime');
      expect(a.pointer).toEqual(beforeA);
      expect(b.pointer).toEqual(beforeB);
      a.pointerCancel();
      a.dispose();
      b.dispose();
    },
  );
  it('preserves valid pointer state if a listener throws', () => {
    const r = createTestRuntime(),
      node = r.create('view');
    r.root.appendChild(node);
    node.addEventListener('pointerdown', () => {
      throw new Error('listener failed');
    });
    expect(() => r.pointerDown(node)).toThrow('listener failed');
    expect(r.pointer).toEqual({ target: node, down: node, buttons: 1 });
    r.dispose();
  });
});
describe('propagation contract', () => {
  const cases = [
    [
      'normal',
      [
        'parent capture',
        'child capture 1',
        'child capture 2',
        'child bubble 1',
        'child bubble 2',
        'parent bubble',
      ],
    ],
    ['ancestor', ['parent capture', 'parent capture 2']],
    [
      'target capture',
      [
        'parent capture',
        'child capture 1',
        'child capture 2',
        'child bubble 1',
        'child bubble 2',
      ],
    ],
    [
      'target bubble',
      [
        'parent capture',
        'child capture 1',
        'child capture 2',
        'child bubble 1',
        'child bubble 2',
      ],
    ],
    ['immediate capture', ['parent capture', 'child capture 1']],
    [
      'immediate bubble',
      [
        'parent capture',
        'child capture 1',
        'child capture 2',
        'child bubble 1',
      ],
    ],
  ] as const;
  it.each(cases)(
    '%s produces the complete expected sequence',
    (mode, expected) => {
      const r = createTestRuntime(),
        parent = r.create('view'),
        child = r.create('view');
      r.root.appendChild(parent);
      parent.appendChild(child);
      const order: string[] = [];
      parent.addEventListener(
        'click',
        (event) => {
          order.push('parent capture');
          if (mode === 'ancestor') event.stopPropagation();
        },
        true,
      );
      if (mode === 'ancestor')
        parent.addEventListener(
          'click',
          () => order.push('parent capture 2'),
          true,
        );
      child.addEventListener(
        'click',
        (event) => {
          order.push('child capture 1');
          if (mode === 'target capture') event.stopPropagation();
          if (mode === 'immediate capture') event.stopImmediatePropagation();
        },
        true,
      );
      child.addEventListener(
        'click',
        () => order.push('child capture 2'),
        true,
      );
      child.addEventListener('click', (event) => {
        order.push('child bubble 1');
        if (mode === 'target bubble') event.stopPropagation();
        if (mode === 'immediate bubble') event.stopImmediatePropagation();
      });
      child.addEventListener('click', () => order.push('child bubble 2'));
      parent.addEventListener('click', () => order.push('parent bubble'));
      const event = r.fire(child, 'click');
      expect(order).toEqual(expected);
      expect(event.defaultPrevented).toBe(false);
      r.dispose();
    },
  );
  it('keeps cancellation independent of propagation and honors passive/noncancelable events', () => {
    const r = createTestRuntime(),
      node = r.create('view');
    r.root.appendChild(node);
    const order: string[] = [];
    node.addEventListener('custom', (event) => {
      order.push('target');
      event.preventDefault();
    });
    r.root.addEventListener('custom', () => order.push('root'));
    const event = new TestEvent('custom');
    expect(node.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(order).toEqual(['target', 'root']);
    const uncancelable = new TestEvent('custom', { cancelable: false });
    expect(node.dispatchEvent(uncancelable)).toBe(true);
    node.addEventListener('passive', (event) => event.preventDefault(), {
      passive: true,
    });
    expect(r.fire(node, 'passive').defaultPrevented).toBe(false);
    r.dispose();
  });
});
describe('bounded animation ownership', () => {
  it('reclaims completed and cancelled computation state over thousands of interactions', () => {
    const r = createTestRuntime(),
      node = r.create('view', { opacity: 0 });
    r.root.appendChild(node);
    for (let i = 0; i < 2000; i++) {
      const animation = node.animate([{ opacity: 1 }], { duration: 1 });
      r.advanceTime(1);
      expect(animation.playState).toBe('finished');
      expect(r.animations.size).toBe(0);
      expect(node.animations).toHaveLength(0);
      const cancelled = node.animate([{ opacity: 1 }], { duration: 1 });
      cancelled.cancel();
      expect(r.animations.size).toBe(0);
      expect(node.animations).toHaveLength(0);
    }
    r.dispose();
  });
  it('retains forward fill without ongoing evaluation and reacquires ownership on replay', async () => {
    const r = createTestRuntime(),
      node = r.create('view', { opacity: 0 });
    r.root.appendChild(node);
    const first = node.animate([{ opacity: 1 }], {
      duration: 10,
      fill: 'forwards',
    });
    r.advanceTime(10);
    await first.finished;
    expect(node.presentation['opacity']).toBe(1);
    expect(r.activeAnimations.size).toBe(0);
    const samples = r.animationSamples;
    r.advanceTime(100);
    expect(r.animationSamples).toBe(samples);
    const second = node.animate([{ opacity: 0.5 }], {
      duration: 10,
      fill: 'forwards',
    });
    r.advanceTime(10);
    expect(first.playState).toBe('idle');
    expect(node.presentation['opacity']).toBe(0.5);
    expect(r.animations.size).toBe(1);
    const previous = second.finished;
    second.play();
    expect(second.finished).not.toBe(previous);
    expect(r.activeAnimations.size).toBe(1);
    r.advanceTime(10);
    await second.finished;
    expect(node.presentation['opacity']).toBe(0.5);
    second.cancel();
    expect(node.presentation['opacity']).toBe(0);
    expect(r.animations.size).toBe(0);
    r.dispose();
  });
  it.each(['none', 'backwards', 'forwards', 'both'] as const)(
    'honors %s fill during delay and after completion',
    (fill) => {
      const r = createTestRuntime(),
        node = r.create('view', { opacity: 0.2 });
      r.root.appendChild(node);
      node.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 10,
        delay: 10,
        fill,
      });
      expect(node.presentation['opacity']).toBe(
        fill === 'both' || fill === 'backwards' ? 0 : 0.2,
      );
      r.advanceTime(20);
      expect(node.presentation['opacity']).toBe(
        fill === 'both' || fill === 'forwards' ? 1 : 0.2,
      );
      expect(r.activeAnimations.size).toBe(0);
      expect(r.animations.size).toBe(
        fill === 'both' || fill === 'forwards' ? 1 : 0,
      );
      r.dispose();
    },
  );
  it('bounds retained fills and cancels a composed program when any target is removed', async () => {
    const r = createTestRuntime(),
      a = r.create('view', { opacity: 0 }),
      b = r.create('view', { opacity: 0 });
    r.root.appendChild(a);
    r.root.appendChild(b);
    for (let i = 0; i < 1000; i++) {
      a.animate([{ opacity: i % 2 }], { duration: 1, fill: 'forwards' });
      r.advanceTime(1);
      expect(r.animations.size).toBe(1);
      expect(a.animations).toHaveLength(1);
    }
    const program = a.animate({
      kind: 'sequence',
      options: { fill: 'forwards' },
      children: [
        {
          kind: 'parallel',
          children: [
            {
              target: a,
              keyframes: [{ opacity: 0.5 }],
              options: { duration: 10 },
            },
            {
              target: b,
              keyframes: [{ opacity: 1 }],
              options: { duration: 10 },
            },
          ],
        },
        { target: b, keyframes: [{ opacity: 0 }], options: { duration: 10 } },
      ],
    });
    r.advanceTime(5);
    expect(b.presentation['opacity']).toBe(0.5);
    b.remove();
    await expect(program.finished).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(a.presentation['opacity']).toBe(0);
    expect(r.animations.size).toBe(0);
    expect(a.animations).toHaveLength(0);
    expect(b.animations).toHaveLength(0);
    r.dispose();
  });
  it('cancels descendants on removal while preserving an animation across reparenting', () => {
    const r = createTestRuntime(),
      parent = r.create('view'),
      other = r.create('view'),
      child = r.create('view');
    r.root.appendChild(parent);
    r.root.appendChild(other);
    parent.appendChild(child);
    const animation = child.animate([{ opacity: 0 }], { duration: 10 });
    other.appendChild(child);
    expect(animation.playState).toBe('running');
    other.remove();
    expect(animation.playState).toBe('idle');
    expect(r.activeAnimations.size).toBe(0);
    expect(r.animations.size).toBe(0);
    r.dispose();
  });
  it('clears ownership during disposal and prevents retained handles from restarting it', () => {
    const r = createTestRuntime(),
      node = r.create('view');
    r.root.appendChild(node);
    const running = node.animate([{ opacity: 0 }], { duration: 10 });
    const paused = node.animate([{ transform: [{ scale: 2 }] }], {
      duration: 10,
    });
    paused.pause();
    expect(r.activeAnimations.size).toBe(1);
    r.dispose();
    expect(r.animations.size).toBe(0);
    expect(r.activeAnimations.size).toBe(0);
    expect(node.animations).toHaveLength(0);
    expect(running.playState).toBe('idle');
    expect(paused.playState).toBe('idle');
    expect(() => running.play()).toThrow('disposed');
  });
});

describe('modal semantic focus eligibility', () => {
  it('keeps forward/backward traversal and direct focus inside the modal, including owned portals', () => {
    const r = createTestRuntime(),
      background = r.create('input'),
      dialog = r.create('view'),
      first = r.create('input'),
      second = r.create('input'),
      portal = r.create('input');
    r.root.appendChild(background);
    background.focus();
    dialog.accessibility = { modal: true, label: 'Settings' };
    r.overlayRoot.appendChild(dialog);
    dialog.appendChild(first);
    dialog.appendChild(second);
    r.root.appendChild(portal);
    portal.accessibilityParent = dialog;
    expect(r.focusOrder()).toEqual([portal, first, second]);
    r.pressKey('Tab');
    expect(r.focusedNode()).toBe(portal);
    r.pressKey('Tab');
    expect(r.focusedNode()).toBe(first);
    background.focus();
    expect(r.focusedNode()).toBe(first);
    r.pressKey('Tab');
    expect(r.focusedNode()).toBe(second);
    r.pressKey('Tab');
    expect(r.focusedNode()).toBe(portal);
    r.pressKey('Tab', { shiftKey: true });
    expect(r.focusedNode()).toBe(second);
    dialog.remove();
    expect(r.focusOrder()).toEqual([background, portal]);
    expect(r.focusedNode()).toBeNull();
    r.pressKey('Tab');
    expect(r.focusedNode()).toBe(background);
    r.dispose();
  });
  it('uses the last visible nested modal and restores the outer scope when it closes', () => {
    const r = createTestRuntime(),
      outer = r.create('view'),
      a = r.create('input'),
      inner = r.create('view'),
      b = r.create('input');
    outer.accessibility = { modal: true };
    inner.accessibility = { modal: true };
    r.overlayRoot.appendChild(outer);
    outer.appendChild(a);
    outer.appendChild(inner);
    inner.appendChild(b);
    expect(r.focusOrder()).toEqual([b]);
    r.pressKey('Tab');
    r.pressKey('Tab', { shiftKey: true });
    expect(r.focusedNode()).toBe(b);
    a.focus();
    expect(r.focusedNode()).toBe(b);
    inner.remove();
    expect(r.focusOrder()).toEqual([a]);
    r.pressKey('Tab');
    expect(r.focusedNode()).toBe(a);
    outer.remove();
    expect(r.focusOrder()).toEqual([]);
    r.dispose();
  });
  it('preserves native focus on hiding, skips hidden traversal, and clears detached focus without blur', () => {
    const r = createTestRuntime(),
      a = r.create('input'),
      b = r.create('input');
    r.root.appendChild(a);
    r.root.appendChild(b);
    let blurred = false;
    a.addEventListener('blur', () => {
      blurred = true;
    });
    a.focus();
    a.style.display = 'none';
    expect(r.focusedNode()).toBe(a);
    expect(r.focusOrder()).toEqual([b]);
    r.pressKey('Tab');
    expect(r.focusedNode()).toBe(b);
    expect(blurred).toBe(true);
    b.remove();
    expect(r.focusedNode()).toBeNull();
    r.dispose();
  });
  it('retains normal tree traversal for focusable nodes without their own semantic element', () => {
    const r = createTestRuntime(),
      a = r.create('view'),
      b = r.create('input');
    a.focusable = true;
    a.accessibility = { accessible: false };
    r.root.appendChild(a);
    r.overlayRoot.appendChild(b);
    expect(r.focusOrder()).toEqual([a, b]);
    r.pressKey('Tab');
    expect(r.focusedNode()).toBe(a);
    r.pressKey('Tab', { shiftKey: true });
    expect(r.focusedNode()).toBe(b);
    r.dispose();
  });
});

it('resets propagation flags when an event is dispatched again and clears dispatch state after errors', () => {
  const r = createTestRuntime(),
    node = r.create('view');
  r.root.appendChild(node);
  const order: string[] = [];
  const stop = (event: TestEvent) => event.stopImmediatePropagation();
  node.addEventListener('custom', stop, true);
  node.addEventListener('custom', () => order.push('target'));
  r.root.addEventListener('custom', () => order.push('root'));
  const event = new TestEvent('custom');
  node.dispatchEvent(event);
  node.removeEventListener('custom', stop, true);
  node.dispatchEvent(event);
  expect(order).toEqual(['target', 'root']);
  expect(event.currentTarget).toBeNull();
  expect(event.eventPhase).toBe(0);
  node.addEventListener('failure', () => {
    throw new Error('listener failed');
  });
  const failing = new TestEvent('failure');
  expect(() => node.dispatchEvent(failing)).toThrow('listener failed');
  expect(failing.currentTarget).toBeNull();
  expect(failing.eventPhase).toBe(0);
  r.dispose();
});
it('validates a capture before pointer cancellation mutates state', () => {
  const a = createTestRuntime(),
    b = createTestRuntime(),
    foreign = b.create('view');
  a.pointer.down = foreign;
  a.pointer.target = foreign;
  a.pointer.buttons = 1;
  const before = { ...a.pointer };
  expect(() => a.pointerCancel()).toThrow('another runtime');
  expect(a.pointer).toEqual(before);
  expect(b.pointer.buttons).toBe(0);
  a.pointer.down = null;
  a.pointer.target = null;
  a.pointer.buttons = 0;
  a.dispose();
  b.dispose();
});

it('hides a portal from both semantics and focus when its logical owner is hidden', () => {
  const r = createTestRuntime(),
    dialog = r.create('view'),
    owner = r.create('view'),
    portal = r.create('input');
  dialog.accessibility = { modal: true };
  r.overlayRoot.appendChild(dialog);
  dialog.appendChild(owner);
  r.root.appendChild(portal);
  portal.accessibilityParent = owner;
  expect(r.focusOrder()).toEqual([portal]);
  owner.style.display = 'none';
  expect(r.semantics()[0]!.children[0]!.hidden).toBe(true);
  expect(r.focusOrder()).toEqual([]);
  portal.focus();
  expect(r.focusedNode()).toBeNull();
  r.dispose();
});

it('removing an application subtree cleans up timing and repeating paint animations', () => {
  const runtime = createTestRuntime();
  const parent = runtime.create('view'),
    panel = runtime.create('view'),
    paint = runtime.create('view');
  runtime.root.appendChild(parent);
  parent.appendChild(panel);
  parent.appendChild(paint);
  const timing = panel.animate([{ opacity: 0.5 }, { opacity: 1 }], {
    duration: 250,
    fill: 'forwards',
  });
  const repeating = paint.animate(
    [{ backgroundColor: '#ff0000' }, { backgroundColor: '#0000ff' }],
    { duration: 500, iterations: Infinity },
  );
  runtime.advanceTime(125);
  expect(runtime.activeAnimations.size).toBe(2);
  parent.remove();
  expect(timing.playState).toBe('idle');
  expect(repeating.playState).toBe('idle');
  expect(runtime.activeAnimations.size).toBe(0);
  expect(runtime.animations.size).toBe(0);
  runtime.advanceTime(500);
  expect(runtime.activeAnimations.size).toBe(0);
  runtime.dispose();
});
