import { describe, expect, it, vi } from 'vitest';

import {
  createTestRuntime,
  createUiModule,
  TestEvent,
  print,
  VirtualClock,
} from './index';

describe('isolated lifecycle and trees', () => {
  it('owns ids, roots, focus, pointers, clock and cleanup independently', () => {
    const a = createTestRuntime(),
      b = createTestRuntime();
    const x = a.create('input'),
      y = b.create('input');
    a.root.appendChild(x);
    b.overlayRoot.appendChild(y);
    x.focus();
    y.focus();
    expect(x.id).toBe(y.id);
    expect(a.focusedNode()).toBe(x);
    expect(b.focusedNode()).toBe(y);
    a.advanceTime(100);
    expect(b.clock.now).toBe(0);
    expect(() => a.root.appendChild(y)).toThrow('another runtime');
    a.dispose();
    a.dispose();
    expect(a.nodes.size).toBe(0);
    expect(a.clock.pending).toBe(0);
    expect(b.focusedNode()).toBe(y);
    expect(() => a.create('view')).toThrow('disposed');
    b.dispose();
  });
  it('reparents, orders siblings and rejects cycles and absent children', () => {
    const r = createTestRuntime(),
      a = r.create('view'),
      b = r.create('view'),
      c = r.create('text');
    c.text = 'Hello';
    r.root.appendChild(a);
    a.appendChild(c);
    r.root.insertBefore(b, a);
    b.appendChild(c);
    expect(print(r.root)).toBe('view[view[text"Hello"] view]');
    expect(b.nextSibling).toBe(a);
    expect(a.previousSibling).toBe(b);
    expect(() => c.appendChild(a)).toThrow();
    expect(() => b.appendChild(r.root)).toThrow('cycle');
    expect(() => a.removeChild(c)).toThrow('not a child');
    b.remove();
    expect(c.isConnected).toBe(false);
    r.dispose();
  });
});
describe('events and input', () => {
  it('captures then targets then bubbles, snapshots listeners and clears currentTarget', () => {
    const r = createTestRuntime(),
      node = r.create('view');
    r.root.appendChild(node);
    const calls: string[] = [];
    r.root.addEventListener('click', () => calls.push('capture'), true);
    node.addEventListener('click', () => calls.push('target'));
    r.root.addEventListener('click', () => calls.push('bubble'));
    const event = r.fire(node, 'click');
    expect(calls).toEqual(['capture', 'target', 'bubble']);
    expect(event.target).toBe(node);
    expect(event.currentTarget).toBeNull();
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
    });
    calls.length = 0;
    expect(node.dispatchEvent(new TestEvent('click'))).toBe(false);
    expect(calls).toEqual(['capture', 'target']);
    r.dispose();
  });
  it('blurs before focusing and traverses displayed focusable nodes', () => {
    const r = createTestRuntime(),
      a = r.create('input'),
      b = r.create('input'),
      hidden = r.create('view', { display: 'none' }),
      c = r.create('input');
    r.root.appendChild(a);
    r.root.appendChild(hidden);
    hidden.appendChild(c);
    r.overlayRoot.appendChild(b);
    const calls: string[] = [];
    a.addEventListener('blur', () => calls.push('blur'));
    b.addEventListener('focus', () => calls.push('focus'));
    r.pressKey('Tab');
    expect(r.focusedNode()).toBe(a);
    r.pressKey('Tab');
    expect(calls).toEqual(['blur', 'focus']);
    r.pressKey('Tab', { shiftKey: true });
    expect(r.focusedNode()).toBe(a);
    a.remove();
    expect(r.focusedNode()).toBeNull();
    r.dispose();
  });
  it('edits input selection, honors prevented input, and commits on blur', () => {
    const r = createTestRuntime(),
      node = r.create('input');
    r.root.appendChild(node);
    node.value = 'abcd';
    node.focus();
    node.setSelectionRange(1, 3);
    const input = vi.fn(),
      change = vi.fn();
    node.addEventListener('input', input);
    node.addEventListener('change', change);
    r.fire(node, 'beforeinput', { data: 'X' });
    expect(node.value).toBe('aXd');
    expect(node.selectionStart).toBe(2);
    expect(input).toHaveBeenCalledOnce();
    r.pressKey('Backspace');
    expect(node.value).toBe('ad');
    node.blur();
    expect(change).toHaveBeenCalledOnce();
    node.addEventListener('beforeinput', (event) => event.preventDefault());
    r.fire(node, 'beforeinput', { data: '!' });
    expect(node.value).toBe('ad');
    r.dispose();
  });
  it('presses with pointer and keyboard; long presses suppress clicks and cancel cleanly', () => {
    const r = createTestRuntime(),
      node = r.create('view');
    r.root.appendChild(node);
    const press = vi.fn(),
      long = vi.fn(),
      out = vi.fn();
    const cleanup = r.pressable(node, {
      onPress: press,
      onLongPress: long,
      onPressOut: out,
    });
    r.pointerDown(node);
    expect(node.focused).toBe(true);
    r.advanceTime(499);
    expect(long).not.toHaveBeenCalled();
    r.advanceTime(1);
    expect(long).toHaveBeenCalledOnce();
    r.pointerUp(node);
    expect(press).not.toHaveBeenCalled();
    expect(out).toHaveBeenCalledOnce();
    r.pressKey('Enter');
    expect(press).toHaveBeenCalledOnce();
    r.pointerDown(node);
    cleanup();
    r.advanceTime(1000);
    expect(long).toHaveBeenCalledOnce();
    expect(r.pressables.size).toBe(0);
    r.dispose();
  });
});
describe('services and semantics', () => {
  it('clamps parameters, nests gestures and only notifies changes', () => {
    const r = createTestRuntime({
      parameters: [
        { id: 'gain', label: 'Gain', type: 'int', min: 0, max: 10, default: 2 },
        {
          id: 'mode',
          label: 'Mode',
          type: 'enum',
          values: ['a', 'b'],
          default: 'a',
        },
      ],
    });
    const gain = r.parameters.byId['gain']!,
      listener = vi.fn(),
      stop = gain.subscribe(listener);
    gain.set(11);
    gain.set(20);
    expect(gain.get()).toBe(10);
    expect(listener).toHaveBeenCalledOnce();
    gain.beginGesture();
    gain.beginGesture();
    gain.endGesture();
    expect(gain.inGesture).toBe(true);
    gain.endGesture();
    expect(gain.inGesture).toBe(false);
    expect(() => gain.set('x')).toThrow();
    expect(() => r.parameters.byId['mode']!.set('c')).toThrow();
    stop();
    gain.set(0);
    expect(listener).toHaveBeenCalledOnce();
    r.dispose();
    expect(() => gain.set(1)).toThrow('disposed');
    expect(listener).toHaveBeenCalledOnce();
  });
  it('stores JSON copies and configures host and native mocks deterministically', async () => {
    const r = createTestRuntime(),
      value = { a: 1 };
    await r.storage.set('preset', value);
    value.a = 2;
    expect(await r.storage.get('preset')).toEqual({ a: 1 });
    expect(await r.storage.keys()).toEqual(['preset']);
    await expect(r.storage.set('bad', undefined)).rejects.toThrow('JSON');
    const listener = vi.fn();
    r.subscribe(listener);
    r.setHost({ hostName: 'Reaper' });
    expect(r.snapshot().hostName).toBe('Reaper');
    expect(listener).toHaveBeenCalledOnce();
    expect(() => r.callNative('load', [])).toThrow('mock');
    r.mockNative('load', () => 42);
    expect(r.callNative('load', [])).toBe(42);
    r.dispose();
    await expect(r.storage.get('preset')).rejects.toThrow('disposed');
  });
  it('uses Soundor roles, leaf names, modal visibility and portal ownership', () => {
    const r = createTestRuntime(),
      button = r.create('view'),
      text = r.create('text'),
      dialog = r.create('view'),
      portal = r.create('input');
    text.text = 'Save';
    button.accessibility = {
      role: 'button',
      state: { disabled: true },
      hint: 'Save preset',
    };
    button.appendChild(text);
    r.root.appendChild(button);
    expect(r.semantics()[0]).toMatchObject({
      role: 'button',
      name: 'Save',
      description: 'Save preset',
      state: { disabled: true },
      children: [],
    });
    dialog.accessibility = { modal: true, label: 'Settings' };
    r.overlayRoot.appendChild(dialog);
    portal.accessibility = { label: 'Name' };
    portal.accessibilityParent = dialog;
    r.overlayRoot.appendChild(portal);
    expect(r.semantics()[0]!.hidden).toBe(true);
    expect(r.semantics()[1]).toMatchObject({
      role: 'dialog',
      name: 'Settings',
      children: [{ role: 'textinput', name: 'Name', hidden: false }],
    });
    r.dispose();
  });
});
describe('fonts', () => {
  it("registers fonts with the runtimes' argument checks", async () => {
    const runtime = createTestRuntime();
    const ui = createUiModule(runtime);
    await expect(
      ui.registerFont('Brand', 'a.ttf', { weight: 'bold' }),
    ).resolves.toBeUndefined();
    expect(() => ui.registerFont('', 'a.ttf')).toThrow(
      new TypeError(
        "registerFont(): family must be a non-empty string, got ''",
      ),
    );
    expect(() => ui.registerFont('Brand', 'a.ttf', { weight: 1001 })).toThrow(
      "registerFont(): weight must be a weight from 1 to 1000, 'normal' or 'bold', got 1001",
    );
    runtime.dispose();
  });
});

describe('deterministic animations', () => {
  it('samples presentation without rewriting base style; delay, pause, completion and cancellation', async () => {
    const r = createTestRuntime(),
      node = r.create('view', { opacity: 0 });
    r.root.appendChild(node);
    const a = node.animate([{ opacity: 1 }], {
      duration: 100,
      delay: 50,
      fill: 'both',
    });
    node.style.opacity = 0.8;
    r.advanceTime(50);
    expect(node.presentation['opacity']).toBe(0);
    r.advanceTime(50);
    expect(node.presentation['opacity']).toBe(0.5);
    expect(node.style.opacity).toBe(0.8);
    a.pause();
    r.advanceTime(200);
    expect(a.currentTime).toBe(100);
    a.resume();
    r.advanceTime(50);
    await expect(a.finished).resolves.toBeUndefined();
    expect(a.playState).toBe('finished');
    expect(node.presentation['opacity']).toBe(1);
    a.cancel();
    expect(node.presentation['opacity']).toBe(0.8);
    r.dispose();
  });
  it('supports seeking, replay, repetition and independent ownership conflicts', async () => {
    const r = createTestRuntime(),
      node = r.create('view', { opacity: 0 });
    const a = node.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 100,
      iterations: 2,
      direction: 'alternate',
      fill: 'forwards',
    });
    r.advanceTime(150);
    expect(node.presentation['opacity']).toBeCloseTo(0.5);
    a.finish();
    await a.finished;
    const prior = a.finished;
    a.currentTime = 50;
    expect(a.playState).toBe('paused');
    expect(a.finished).not.toBe(prior);
    a.cancel();
    await expect(a.finished).rejects.toMatchObject({ name: 'AbortError' });
    a.play();
    expect(a.playState).toBe('running');
    const transform = node.animate([{ transform: [{ scale: 2 }] }]);
    expect(a.playState).toBe('running');
    node.animate([{ opacity: 0.25 }]);
    expect(a.playState).toBe('idle');
    expect(transform.playState).toBe('running');
    r.dispose();
  });
  it('runs sequence origins, parallel targets, springs, and reduced motion', async () => {
    const r = createTestRuntime(),
      a = r.create('view', { opacity: 0 }),
      b = r.create('view', { opacity: 0 });
    const program = a.animate({
      kind: 'sequence',
      options: { fill: 'forwards' },
      children: [
        {
          kind: 'parallel',
          children: [
            {
              target: a,
              keyframes: [{ opacity: 1 }],
              options: { duration: 100 },
            },
            {
              target: b,
              keyframes: [{ opacity: 0.5 }],
              options: { duration: 100 },
            },
          ],
        },
        { kind: 'delay', duration: 50 },
        { keyframes: [{ opacity: 0 }], options: { duration: 100 } },
      ],
    });
    r.advanceTime(100);
    expect(a.presentation['opacity']).toBe(1);
    expect(b.presentation['opacity']).toBe(0.5);
    r.advanceTime(100);
    expect(a.presentation['opacity']).toBeCloseTo(0.5);
    r.advanceTime(50);
    await program.finished;
    expect(a.presentation['opacity']).toBe(0);
    const spring = b.animate([{ opacity: 1 }], {
      type: 'spring',
      fill: 'forwards',
    });
    r.advanceTime(100);
    expect(Number(b.presentation['opacity'])).toBeGreaterThan(0.5);
    r.setReducedMotion(true);
    expect(spring.playState).toBe('finished');
    r.dispose();
  });
  it('rejects invalid time, cross-runtime targets and infinite finish; disposal rejects pending work', async () => {
    const r = createTestRuntime(),
      other = createTestRuntime();
    expect(() => r.advanceTime(-1)).toThrow();
    expect(() =>
      r.root.animate({ target: other.root, keyframes: [{ opacity: 0 }] }),
    ).toThrow('another runtime');
    const a = r.root.animate([{ opacity: 0 }], { iterations: Infinity });
    expect(() => a.finish()).toThrow('infinite');
    r.dispose();
    await expect(a.finished).rejects.toMatchObject({ name: 'AbortError' });
    other.dispose();
  });
});
it('clock processes nested callbacks by deadline and clears resources', () => {
  const clock = new VirtualClock(),
    calls: number[] = [];
  clock.setTimeout(() => {
    calls.push(clock.now);
    clock.setTimeout(() => calls.push(clock.now), 5);
  }, 10);
  clock.advance(20);
  expect(calls).toEqual([10, 15]);
  expect(clock.now).toBe(20);
  expect(clock.pending).toBe(0);
});

it('deduplicates listeners, supports once, abort and immediate propagation', () => {
  const r = createTestRuntime(),
    node = r.root,
    call = vi.fn<() => void>();
  const controller = new AbortController();
  node.addEventListener('custom', call, { once: true });
  node.addEventListener('custom', call, { once: true });
  r.fire(node, 'custom');
  r.fire(node, 'custom');
  expect(call).toHaveBeenCalledOnce();
  node.addEventListener('custom', call, { signal: controller.signal });
  controller.abort();
  r.fire(node, 'custom');
  expect(call).toHaveBeenCalledOnce();
  node.addEventListener('custom', (event) => event.stopImmediatePropagation());
  node.addEventListener('custom', call);
  r.fire(node, 'custom');
  expect(call).toHaveBeenCalledOnce();
  r.dispose();
});

it('rejects simultaneous ownership conflicts inside compositions before replacing an existing animation', () => {
  const r = createTestRuntime(),
    active = r.root.animate([{ opacity: 0 }]);
  expect(() =>
    r.root.animate({
      kind: 'parallel',
      children: [
        { keyframes: [{ opacity: 0 }] },
        { keyframes: [{ opacity: 1 }] },
      ],
    }),
  ).toThrow('disjoint');
  expect(active.playState).toBe('running');
  r.dispose();
});
it('holds a final authored keyframe through the end of its track', () => {
  const r = createTestRuntime(),
    node = r.root;
  node.animate([{ opacity: 0 }, { opacity: 1, offset: 0.5 }], {
    duration: 100,
    fill: 'forwards',
  });
  r.advanceTime(75);
  expect(node.presentation['opacity']).toBe(1);
  r.dispose();
});

it('runs target capture listeners first, matching the native event module', () => {
  const r = createTestRuntime(),
    order: string[] = [];
  r.root.addEventListener('click', () => order.push('bubble'));
  r.root.addEventListener('click', () => order.push('capture'), true);
  r.fire(r.root, 'click');
  expect(order).toEqual(['capture', 'bubble']);
  r.dispose();
});

it('cancels long presses after pointer movement and retains implicit pointer capture', () => {
  const r = createTestRuntime(),
    button = r.create('view'),
    other = r.create('view'),
    long = vi.fn<() => void>();
  r.root.appendChild(button);
  r.root.appendChild(other);
  r.pressable(button, { onLongPress: long });
  const moved = vi.fn<() => void>();
  button.addEventListener('pointermove', moved);
  r.pointerDown(button, { clientX: 1 });
  r.pointerMove(other, { clientX: 30 });
  r.advanceTime(500);
  expect(long).not.toHaveBeenCalled();
  expect(moved).toHaveBeenCalledOnce();
  r.pointerCancel();
  r.dispose();
});

it('evaluates springs in property units and preserves analytic retarget velocity', () => {
  const r = createTestRuntime(),
    node = r.create('view', { transform: [{ translateX: 0 }] });
  node.animate([{ transform: [{ translateX: 100 }] }], {
    type: 'spring',
    fill: 'forwards',
  });
  r.advanceTime(100);
  const position = Number(
      (node.presentation['transform'] as { translateX: number }[])[0]!
        .translateX,
    ),
    velocity = Number(
      (r.velocity(node)['transform'] as { translateX: number }[])[0]!
        .translateX,
    );
  expect(position).toBeGreaterThan(0);
  expect(velocity).toBeGreaterThan(0);
  node.animate([{ transform: [{ translateX: 0 }] }], {
    type: 'spring',
    fill: 'forwards',
  });
  expect(
    Number(
      (r.velocity(node)['transform'] as { translateX: number }[])[0]!
        .translateX,
    ),
  ).toBeCloseTo(velocity);
  r.advanceTime(1);
  expect(
    Number(
      (node.presentation['transform'] as { translateX: number }[])[0]!
        .translateX,
    ),
  ).toBeGreaterThan(position);
  r.advanceTime(10000);
  expect(node.presentation['transform']).toEqual([{ translateX: 0 }]);
  r.dispose();
});
it('finishes a spring with no displacement immediately', () => {
  const r = createTestRuntime(),
    node = r.create('view', { opacity: 0.25 });
  const animation = node.animate([{ opacity: 0.25 }], { type: 'spring' });
  expect(animation.playState).toBe('finished');
  r.dispose();
});
it('preserves independent property presentations and rejects reordered transforms', () => {
  const r = createTestRuntime(),
    node = r.create('view', { opacity: 0, transform: [{ scale: 1 }] });
  node.animate([{ transform: [{ scale: 2 }] }], {
    duration: 100,
    fill: 'forwards',
  });
  node.animate([{ opacity: 1 }], { duration: 100, fill: 'forwards' });
  r.advanceTime(50);
  expect(node.presentation['opacity']).toBe(0.5);
  expect(node.presentation['transform']).toEqual([{ scale: 1.5 }]);
  expect(() =>
    node.animate([
      { transform: [{ scale: 1 }, { rotate: 0 }] },
      { transform: [{ rotate: 1 }, { scale: 2 }] },
    ]),
  ).toThrow('operation order');
  r.dispose();
});

it('reduced motion completes delayed infinite programs including their finite prefix', async () => {
  const r = createTestRuntime(),
    node = r.create('view', { opacity: 0 });
  const animation = node.animate({
    kind: 'sequence',
    options: { fill: 'forwards' },
    children: [
      { kind: 'delay', duration: 500 },
      {
        keyframes: [{ opacity: 1 }],
        options: { duration: 100, iterations: Infinity },
      },
    ],
  });
  r.setReducedMotion(true);
  expect(animation.playState).toBe('finished');
  expect(animation.currentTime).toBe(600);
  expect(node.presentation['opacity']).toBe(1);
  await animation.finished;
  r.dispose();
});

it('completes reversed springs at their origin and honors fractional iteration spans', () => {
  const r = createTestRuntime(),
    node = r.create('view', { transform: [{ translateX: 0 }] });
  const reverse = node.animate([{ transform: [{ translateX: 100 }] }], {
    type: 'spring',
    direction: 'reverse',
    fill: 'forwards',
  });
  reverse.finish();
  expect(node.presentation['transform']).toEqual([{ translateX: 0 }]);
  const fraction = node.animate([{ transform: [{ translateX: 100 }] }], {
    type: 'spring',
    iterations: 0.5,
    fill: 'forwards',
  });
  fraction.finish();
  expect(
    Number(
      (node.presentation['transform'] as { translateX: number }[])[0]!
        .translateX,
    ),
  ).not.toBe(100);
  expect(fraction.playState).toBe('finished');
  r.dispose();
});

it('requires explicit mocks even for native method names on Object.prototype', () => {
  const runtime = createTestRuntime();
  expect(() => runtime.callNative('toString', [])).toThrow(
    'configured test mock',
  );
  runtime.mockNative('__proto__', () => 7);
  expect(runtime.callNative('__proto__', [])).toBe(7);
  expect(Object.getPrototypeOf(runtime.native)).toBeNull();
  runtime.dispose();
});

it('retains mouse capture until the final button release and clicks the shared ancestor', () => {
  const runtime = createTestRuntime(),
    parent = runtime.create('view'),
    a = runtime.create('view'),
    b = runtime.create('view');
  runtime.root.appendChild(parent);
  parent.appendChild(a);
  parent.appendChild(b);
  const clicks: unknown[] = [],
    moves: unknown[] = [];
  parent.addEventListener('click', (event) => clicks.push(event.target));
  a.addEventListener('pointermove', (event) =>
    moves.push([event.target, event.button, event.buttons]),
  );
  runtime.pointerDown(a);
  runtime.pointerDown(b, { button: 1 });
  expect(runtime.pointer.buttons).toBe(5);
  runtime.pointerUp(b, { button: 1 });
  expect(runtime.pointer.down).toBe(a);
  runtime.pointerMove(b);
  expect(moves).toEqual([[a, -1, 1]]);
  runtime.pointerUp(b);
  expect(clicks).toEqual([parent]);
  expect(runtime.pointer.down).toBeNull();
  runtime.dispose();
});

it('locks a press to the node asking from its pointerdown, until the release', async () => {
  const runtime = createTestRuntime(),
    ui = createUiModule(runtime),
    knob = runtime.create('view'),
    face = runtime.create('view'),
    other = runtime.create('view');
  runtime.root.appendChild(knob);
  knob.appendChild(face);
  runtime.root.appendChild(other);
  await expect(knob.requestPointerLock()).rejects.toMatchObject({
    name: 'NotAllowedError',
  });
  let locking: Promise<void> | undefined;
  knob.addEventListener('pointerdown', () => {
    locking = knob.requestPointerLock();
    locking.catch(() => {}); // a touch is refused below
  });
  const moves: unknown[] = [];
  knob.addEventListener('pointermove', (event) =>
    moves.push([event.target, event['movementY']]),
  );
  runtime.pointerDown(face);
  await expect(locking).resolves.toBeUndefined();
  expect(ui.pointerLockNode()).toBe(knob);
  await expect(other.requestPointerLock()).rejects.toThrow();
  runtime.pointerMove(other, { movementY: -14 });
  expect(moves).toEqual([[knob, -14]]);
  runtime.pointerUp(other);
  expect(ui.pointerLockNode()).toBeNull();

  runtime.pointerDown(knob);
  await knob.requestPointerLock();
  ui.exitPointerLock();
  expect(ui.pointerLockNode()).toBeNull();
  runtime.pointerUp(knob);
  runtime.pointerDown(knob, { pointerType: 'touch' });
  await expect(knob.requestPointerLock()).rejects.toThrow();
  runtime.pointerUp(knob);
  runtime.dispose();
});

it('rejects unsupported button operations before modifying capture or button state', () => {
  const runtime = createTestRuntime(),
    a = runtime.create('view'),
    b = runtime.create('view');
  runtime.pointerDown(a);
  expect(() => runtime.pointerDown(b, { button: 4 })).toThrow(
    'Supported mouse buttons',
  );
  expect(() => runtime.pointerUp(b, { button: 4 })).toThrow(
    'Supported mouse buttons',
  );
  expect(runtime.pointer).toEqual({
    down: a,
    target: a,
    buttons: 1,
    type: 'mouse',
    locked: null,
  });
  runtime.dispose();
});

it('uses native cancellation flags for focus, input, change and hover notifications', () => {
  const runtime = createTestRuntime(),
    node = runtime.create('input');
  runtime.root.appendChild(node);
  const focus = vi.fn((event: TestEvent) => {
    event.preventDefault();
    expect(event.cancelable).toBe(false);
  });
  node.addEventListener('focus', focus);
  node.focus();
  expect(focus).toHaveBeenCalledOnce();
  for (const type of [
    'blur',
    'input',
    'change',
    'scroll',
    'pointercancel',
    'pointerenter',
    'pointerleave',
  ]) {
    node.addEventListener(type, (event) => event.preventDefault());
    expect(runtime.fire(node, type).defaultPrevented).toBe(false);
  }
  node.addEventListener('beforeinput', (event) => event.preventDefault());
  expect(
    runtime.fire(node, 'beforeinput', { data: 'x' }).defaultPrevented,
  ).toBe(true);
  expect(node.value).toBe('');
  runtime.dispose();
});

describe('the view size', () => {
  it('starts at the configured size and tells subscribers once per change', () => {
    const runtime = createTestRuntime({ view: { width: 640, height: 480 } });
    const ui = createUiModule(runtime);
    const size = ui.viewSize();
    expect(size).toEqual({ width: 640, height: 480, scale: 1 });
    expect(ui.viewSize()).toBe(size);
    const a = vi.fn<(size: unknown) => void>();
    const b = vi.fn<(size: unknown) => void>();
    ui.subscribeViewSize(a);
    const unsubscribe = ui.subscribeViewSize(b);
    runtime.setViewSize({ width: 900 });
    runtime.setViewSize({ width: 900, height: 480 });
    expect(a).toHaveBeenCalledOnce();
    expect(a).toHaveBeenLastCalledWith({ width: 900, height: 480, scale: 1 });
    expect(ui.viewSize()).toBe(a.mock.calls[0]![0]);
    unsubscribe();
    runtime.setViewSize({ scale: 2 });
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledOnce();
    expect(() => runtime.setViewSize({ height: Number.NaN })).toThrow(
      RangeError,
    );
    runtime.dispose();
    expect(() => ui.viewSize()).toThrow('disposed');
  });

  it('is 800×600 by default', () => {
    expect(createUiModule(createTestRuntime()).viewSize()).toEqual({
      width: 800,
      height: 600,
      scale: 1,
    });
  });
});
