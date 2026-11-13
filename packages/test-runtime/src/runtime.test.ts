import { resolveConfig } from '@soundor/config';
import { describe, expect, it, vi } from 'vitest';

import {
  createTestRuntime,
  createUiModule,
  isTestNode,
  TestEvent,
  TestResizeObserver,
  print,
  setParameterAsHost,
  VirtualClock,
} from './index';

describe('ResizeObserver', () => {
  it('observes nodes from any copy of this package, and nothing else', () => {
    const runtime = createTestRuntime();
    const node = runtime.create('view');
    const observer = new TestResizeObserver(() => {});
    observer.observe(node, { box: 'border-box' });
    expect([...observer.observed]).toEqual([[node, 'border-box']]);
    // Another copy's node: its own class, the same brand.
    const elsewhere = Object.create({
      get [Symbol.for('soundor.test-node.v1')]() {
        return true;
      },
    }) as never;
    expect(isTestNode(elsewhere)).toBe(true);
    expect(() => observer.observe(elsewhere)).not.toThrow();
    expect(() => observer.observe({})).toThrow('not a UiNode');
    expect(() => observer.observe(node, { box: 'padding' as never })).toThrow(
      'not a valid box',
    );
    // Not an own property: nodes print and spread as before.
    expect(Object.getOwnPropertySymbols(node)).toEqual([]);
    observer.disconnect();
    expect(observer.observed.size).toBe(0);
    runtime.dispose();
  });
});

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
  it('shows focus the keyboard moved, and a pressed node from a key on', () => {
    const r = createTestRuntime(),
      a = r.create('view'),
      b = r.create('view'),
      input = r.create('input');
    a.focusable = b.focusable = true;
    r.root.appendChild(a);
    r.root.appendChild(b);
    r.root.appendChild(input);
    const changes: string[] = [];
    for (const [node, name] of [
      [a, 'a'],
      [b, 'b'],
    ] as const)
      node.addEventListener('focusvisiblechange', (event) =>
        changes.push(`${name}:${String(event['focusVisible'])}`),
      );
    r.pointerDown(a);
    r.pointerUp(a);
    expect([a.focused, a.focusVisible]).toEqual([true, false]);
    r.pressKey('Shift');
    r.pressKey('c', { ctrlKey: true });
    expect(a.focusVisible).toBe(false);
    r.pressKey('ArrowUp');
    expect(a.focusVisible).toBe(true);
    r.pressKey('Tab');
    expect([a.focusVisible, b.focusVisible]).toEqual([false, true]);
    expect(changes).toEqual(['a:true', 'a:false', 'b:true']);
    // A text input shows focus however it got it.
    r.pointerDown(a);
    r.pointerUp(a);
    input.focus();
    expect(input.focusVisible).toBe(true);
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
      parameters: resolveConfig({
        plugin: { id: 'com.example.test', name: 'Test' },
        runtimes: [],
        parameters: {
          gain: { type: 'int32', label: 'Gain', min: 0, max: 10, default: 2 },
          mode: {
            type: 'choice',
            label: 'Mode',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ],
            default: 'a',
          },
          meter: {
            type: 'float32',
            label: 'Meter',
            min: -60,
            max: 0,
            default: 0,
            access: 'readOnly',
          },
        },
      }).parameters,
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
    // The behavior is the config's, compiled as the Web runtime compiles it.
    expect(r.parameters.byId['mode']!.format('b')).toBe('B');
    expect(r.parameters.byId['mode']!.parse('a')).toBe('a');
    expect(gain.fromNormalized(0.5)).toBe(5);
    const meter = r.parameters.byId['meter']!;
    expect(() => meter.set(-3)).toThrow("Parameter 'meter' is read-only");
    setParameterAsHost(meter, -3);
    expect(meter.get()).toBe(-3);
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

it('counts a click as its press says, and makes the second a double click', () => {
  const runtime = createTestRuntime(),
    node = runtime.create('view');
  runtime.root.appendChild(node);
  const seen: string[] = [];
  for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick'])
    node.addEventListener(type, (event) =>
      seen.push(`${event.type}:${String(event['detail'])}`),
    );
  runtime.pointerDown(node);
  runtime.pointerUp(node);
  runtime.pointerDown(node, { detail: 2 });
  runtime.pointerUp(node);
  runtime.pointerDown(node, { detail: 3 });
  runtime.pointerUp(node);
  expect(seen).toEqual([
    'pointerdown:0',
    'pointerup:0',
    'click:1',
    'pointerdown:0',
    'pointerup:0',
    'click:2',
    'dblclick:2',
    'pointerdown:0',
    'pointerup:0',
    'click:3',
  ]);
  expect(() => runtime.pointerDown(node, { detail: 0 })).toThrow(RangeError);
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
    clicks: 1,
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
    expect(size).toEqual({
      width: 640,
      height: 480,
      scale: 1,
      safeArea: { x: 0, y: 0, width: 640, height: 480 },
    });
    expect(ui.viewSize()).toBe(size);
    const a = vi.fn<(size: unknown) => void>();
    const b = vi.fn<(size: unknown) => void>();
    ui.subscribeViewSize(a);
    const unsubscribe = ui.subscribeViewSize(b);
    runtime.setViewSize({ width: 900 });
    runtime.setViewSize({ width: 900, height: 480 });
    expect(a).toHaveBeenCalledOnce();
    expect(a).toHaveBeenLastCalledWith({
      width: 900,
      height: 480,
      scale: 1,
      safeArea: { x: 0, y: 0, width: 900, height: 480 },
    });
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
      safeArea: { x: 0, y: 0, width: 800, height: 600 },
    });
  });

  it('has the safe area a test sets, the whole view by default', () => {
    const runtime = createTestRuntime({
      view: {
        width: 1000,
        height: 600,
        safeArea: { x: 100, y: 0, width: 800, height: 600 },
      },
    });
    const ui = createUiModule(runtime);
    const first = ui.viewSize();
    expect(first.safeArea).toEqual({ x: 100, y: 0, width: 800, height: 600 });
    expect(Object.isFrozen(first.safeArea)).toBe(true);
    const told = vi.fn<(size: unknown) => void>();
    ui.subscribeViewSize(told);
    // Kept as the view resizes, until set again.
    runtime.setViewSize({ width: 1200 });
    expect(ui.viewSize().safeArea).toEqual(first.safeArea);
    runtime.setViewSize({
      safeArea: { x: 200, y: 0, width: 800, height: 600 },
    });
    runtime.setViewSize({
      safeArea: { x: 200, y: 0, width: 800, height: 600 },
    });
    expect(told).toHaveBeenCalledTimes(2);
    runtime.setViewSize({ safeArea: null });
    expect(ui.viewSize().safeArea).toEqual({
      x: 0,
      y: 0,
      width: 1200,
      height: 600,
    });
    expect(() =>
      runtime.setViewSize({
        safeArea: { x: Number.NaN, y: 0, width: 1, height: 1 },
      }),
    ).toThrow(RangeError);
    // A rejected change changes nothing.
    expect(ui.viewSize().safeArea.width).toBe(1200);
    runtime.dispose();
  });
});

describe('editor visibility', () => {
  it('isolates runtimes, reports transitions and clears subscriptions on disposal', () => {
    const runtime = createTestRuntime();
    const second = createTestRuntime();
    const ui = createUiModule(runtime);
    const listener = vi.fn<(value: boolean) => void>();
    const unsubscribe = ui.subscribeVisibility(listener);
    expect(ui.isVisible()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    runtime.setVisibility(false);
    runtime.setVisibility(false);
    expect(ui.isVisible()).toBe(false);
    expect(second.isVisible()).toBe(true);
    runtime.setVisibility(true);
    expect(listener.mock.calls).toEqual([[false], [true]]);
    unsubscribe();
    runtime.setVisibility(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(() => ui.subscribeVisibility(1 as never)).toThrow(
      'subscribeVisibility() expects a function',
    );
    expect(() => runtime.setVisibility('invalid' as never)).toThrow(
      'visibility must be a boolean',
    );
    runtime.dispose();
    expect(() => ui.isVisible()).toThrow('disposed');
    expect(() => runtime.setVisibility(true)).toThrow('disposed');
    second.dispose();
  });
});

describe('editor focus', () => {
  it('isolates runtimes, reports transitions and clears subscriptions on disposal', () => {
    const runtime = createTestRuntime();
    const second = createTestRuntime();
    const ui = createUiModule(runtime);
    const listener = vi.fn<(value: boolean) => void>();
    const unsubscribe = ui.subscribeFocus(listener);
    const input = ui.createTextInput();
    ui.root.appendChild(input);
    input.focus();
    expect(ui.focusedNode()).toBe(input);
    expect(ui.isFocused()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    runtime.setFocus(true);
    runtime.setFocus(true);
    expect(ui.isFocused()).toBe(true);
    expect(second.isFocused()).toBe(false);
    runtime.setFocus(false);
    expect(ui.focusedNode()).toBe(input);
    expect(ui.isVisible()).toBe(true);
    expect(listener.mock.calls).toEqual([[true], [false]]);
    unsubscribe();
    runtime.setFocus(true);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(() => ui.subscribeFocus(1 as never)).toThrow(
      'subscribeFocus() expects a function',
    );
    expect(() => runtime.setFocus('invalid' as never)).toThrow(
      'focus must be a boolean',
    );
    runtime.dispose();
    expect(() => ui.isFocused()).toThrow('disposed');
    expect(() => runtime.setFocus(false)).toThrow('disposed');
    second.dispose();
  });
});

describe('the editor size', () => {
  it("is the view's by default, the same object until set", () => {
    const runtime = createTestRuntime({ view: { width: 640, height: 480 } });
    const ui = createUiModule(runtime);
    const size = ui.editorSize();
    expect(size).toEqual({ width: 640, height: 480, resizable: false });
    expect(Object.isFrozen(size)).toBe(true);
    expect(ui.editorSize()).toBe(size);
    expect(
      createUiModule(
        createTestRuntime({ editor: { width: 1280, height: 960 } }),
      ).editorSize(),
    ).toEqual({ width: 1280, height: 960, resizable: false });
  });

  it("tells subscribers once per change, apart from the view's", () => {
    const runtime = createTestRuntime();
    const ui = createUiModule(runtime);
    const editor = vi.fn<(size: unknown) => void>();
    const view = vi.fn<(size: unknown) => void>();
    const unsubscribe = ui.subscribeEditorSize(editor);
    ui.subscribeViewSize(view);
    // An editor that scales: twice the size, the layout as it was.
    runtime.setEditorSize({ width: 1600, height: 1200 });
    runtime.setEditorSize({ width: 1600 });
    expect(editor).toHaveBeenCalledOnce();
    expect(editor).toHaveBeenLastCalledWith({
      width: 1600,
      height: 1200,
      resizable: false,
    });
    expect(ui.editorSize()).toBe(editor.mock.calls[0]![0]);
    expect(view).not.toHaveBeenCalled();
    expect(ui.viewSize().width).toBe(800);
    unsubscribe();
    runtime.setEditorSize({ height: 900 });
    expect(editor).toHaveBeenCalledOnce();
    for (const width of [-1, 1.5, Number.NaN, Infinity])
      expect(() => runtime.setEditorSize({ width })).toThrow(RangeError);
    expect(() => ui.subscribeEditorSize(1 as never)).toThrow(
      'subscribeEditorSize() expects a function',
    );
  });

  it('keeps each runtime to itself, and rejects use once disposed', () => {
    const first = createTestRuntime();
    const second = createTestRuntime();
    const told = vi.fn<(size: unknown) => void>();
    createUiModule(second).subscribeEditorSize(told);
    first.setEditorSize({ width: 900 });
    expect(told).not.toHaveBeenCalled();
    expect(createUiModule(second).editorSize().width).toBe(800);
    const ui = createUiModule(first);
    first.dispose();
    expect(() => ui.editorSize()).toThrow('disposed');
    expect(() => ui.subscribeEditorSize(() => {})).toThrow('disposed');
    expect(() => first.setEditorSize({ width: 1000 })).toThrow('disposed');
  });
});

describe('requestEditorSize', () => {
  const resizable = {
    width: 800,
    height: 600,
    resizable: true,
    minWidth: 400,
    minHeight: 300,
    maxWidth: 1600,
    maxHeight: 1200,
  };

  it('is refused by a fixed editor, by default', () => {
    const runtime = createTestRuntime();
    const ui = createUiModule(runtime);
    expect(ui.requestEditorSize(1000, 700)).toBeNull();
    expect(runtime.requestedEditorSizes()).toEqual([]);
  });

  it('resizes after the calling code, held to the limits, the latest winning', async () => {
    const runtime = createTestRuntime({ editor: resizable });
    const ui = createUiModule(runtime);
    const told = vi.fn<(size: unknown) => void>();
    ui.subscribeEditorSize(told);
    // The size asked of the host, held to the limits at once.
    expect(ui.requestEditorSize(1000.4, 99999)).toEqual({
      width: 1000,
      height: 1200,
    });
    expect(ui.requestEditorSize(900.5, 700)).toEqual({
      width: 901,
      height: 700,
    });
    // Asked, not given yet.
    expect(ui.editorSize().width).toBe(800);
    await Promise.resolve();
    expect(told).toHaveBeenCalledOnce();
    expect(ui.editorSize()).toEqual({
      width: 901,
      height: 700,
      resizable: true,
    });
    expect(runtime.requestedEditorSizes()).toEqual([
      { width: 1000, height: 1200 },
      { width: 901, height: 700 },
    ]);
    // The size it has: nothing new.
    ui.requestEditorSize(901, 700);
    await Promise.resolve();
    expect(told).toHaveBeenCalledOnce();
  });

  it('keeps the aspect ratio of an editor that scales, at the nearest size', async () => {
    const runtime = createTestRuntime({
      editor: { ...resizable, aspectRatio: { width: 800, height: 600 } },
    });
    const ui = createUiModule(runtime);
    ui.requestEditorSize(1200, 900);
    await Promise.resolve();
    expect(ui.editorSize()).toMatchObject({ width: 1200, height: 900 });
    // Wider only: between the two sides' zooms, nearer the wider's. The
    // same answer from any size: 1200×900 now.
    ui.requestEditorSize(1200, 600);
    await Promise.resolve();
    expect(ui.editorSize()).toMatchObject({ width: 1056, height: 792 });
    ui.requestEditorSize(5000, 5000);
    await Promise.resolve();
    expect(ui.editorSize()).toMatchObject({ width: 1600, height: 1200 });
  });

  it('can meet a host that ignores requests', async () => {
    const runtime = createTestRuntime({
      editor: { ...resizable, applyRequests: false },
    });
    const ui = createUiModule(runtime);
    expect(ui.requestEditorSize(1000, 700)).toEqual({
      width: 1000,
      height: 700,
    });
    await Promise.resolve();
    expect(ui.editorSize().width).toBe(800);
    expect(runtime.requestedEditorSizes()).toEqual([
      { width: 1000, height: 700 },
    ]);
  });

  it('checks its arguments as the runtimes do', () => {
    const ui = createUiModule(createTestRuntime({ editor: resizable }));
    expect(() => ui.requestEditorSize('500' as never, 400)).toThrow(
      new TypeError('requestEditorSize(): width must be a number, got string'),
    );
    expect(() => ui.requestEditorSize(500, Infinity)).toThrow(
      new RangeError(
        'requestEditorSize(): height must be a finite number, got Infinity',
      ),
    );
    expect(() => ui.requestEditorSize(Number.NaN, 400)).toThrow(RangeError);
    // None, or less: held to the minimum (400×300), as any size.
    expect(ui.requestEditorSize(0, -1)).toEqual({ width: 400, height: 300 });
  });

  it('gives nothing to a runtime disposed before the host answers', async () => {
    const runtime = createTestRuntime({ editor: resizable });
    const ui = createUiModule(runtime);
    const told = vi.fn<(size: unknown) => void>();
    ui.subscribeEditorSize(told);
    ui.requestEditorSize(1000, 700);
    runtime.dispose();
    await Promise.resolve();
    expect(told).not.toHaveBeenCalled();
    expect(() => ui.requestEditorSize(1000, 700)).toThrow('disposed');
  });
});

it('scrolling from code fires scroll at the next frame, once, before its callbacks', () => {
  const runtime = createTestRuntime();
  const scroll = runtime.create('view', { overflow: 'scroll' });
  runtime.root.appendChild(scroll);
  const log: string[] = [];
  scroll.addEventListener('scroll', () =>
    log.push(`scroll ${scroll.scrollTop}`),
  );
  // Set before the scrolling, and still after it.
  runtime.clock.setTimeout(
    () => log.push('frame'),
    runtime.clock.untilNextFrame(),
  );
  scroll.scrollTop = 20;
  scroll.scrollTo({ top: 30 });
  scroll.scrollBy({ top: 10 });
  expect(scroll.scrollTop).toBe(40);
  expect(log).toEqual([]);
  runtime.advanceTime(17);
  expect(log).toEqual(['scroll 40', 'frame']);
  // Where it already is: it did not move.
  scroll.scrollTop = 40;
  runtime.advanceTime(17);
  expect(log).toHaveLength(2);
  // Taken away before it could be told.
  scroll.scrollTop = 0;
  scroll.remove();
  runtime.advanceTime(17);
  expect(log).toHaveLength(2);
});

it('scrolls a view along the axes its style scrolls, and nothing else', () => {
  const runtime = createTestRuntime();
  const list = runtime.create('view', { overflowY: 'scroll' });
  const plain = runtime.create('view', { overflow: 'hidden' });
  runtime.root.appendChild(list);
  runtime.root.appendChild(plain);
  list.scrollTo({ left: 50, top: 30 });
  expect([list.scrollLeft, list.scrollTop]).toEqual([0, 30]);
  plain.scrollTo(0, 30);
  expect(plain.scrollTop).toBe(0);
  expect(() => list.scrollTo({ behavior: 'fast' })).toThrow(TypeError);
  expect(() => list.scrollIntoView({ block: 'top' })).toThrow(TypeError);
  // Stopped: back to its start, and told so.
  const log: number[] = [];
  list.addEventListener('scroll', () => log.push(list.scrollTop));
  runtime.advanceTime(17);
  list.style = { overflow: 'hidden' };
  expect(list.scrollTop).toBe(0);
  runtime.advanceTime(17);
  expect(log).toEqual([30, 0]);
});

it('scrolls smoothly over the virtual clock, eased, and stops for a scroll at once', () => {
  const runtime = createTestRuntime();
  const list = runtime.create('view', { overflow: 'scroll' });
  runtime.root.appendChild(list);
  list.scrollTo({ top: 200, behavior: 'smooth' });
  expect(list.scrollTop).toBe(0);
  runtime.advanceTime(150);
  expect(list.scrollTop).toBeGreaterThan(80);
  expect(list.scrollTop).toBeLessThan(120);
  runtime.advanceTime(200);
  expect(list.scrollTop).toBe(200);
  list.scrollBy({ top: 100, behavior: 'smooth' });
  runtime.advanceTime(100);
  list.scrollTop = 10;
  runtime.advanceTime(400);
  expect(list.scrollTop).toBe(10);
  runtime.setReducedMotion(true);
  list.scrollTo({ top: 50, behavior: 'smooth' });
  expect(list.scrollTop).toBe(50);
});

it('cleans up unfinished state gestures without resetting persistent values', () => {
  const runtime = createTestRuntime({
    state: {
      fields: [
        {
          name: 'selected',
          type: {
            kind: 'nullable',
            inner: { kind: 'primitive', name: 'string' },
          },
          default: null,
        },
      ],
      types: [],
    },
  });
  const field = runtime.state.fields.selected!;
  field.beginGesture();
  field.beginGesture();
  field.set('Warm');
  expect(runtime.state.gestureDepth('selected')).toBe(2);
  runtime.dispose();
  expect(runtime.state.gestureDepth('selected')).toBe(0);
  expect(field.get()).toBe('Warm');
});
