import { createRef } from 'react';
import type { UiNode } from 'soundor:ui';
import { afterEach, expect, it } from 'vitest';

import { Animated, createRoot, flushSync, Text, type Root } from './index';
import { root, reset, type FakeNode } from './testing/fake-ui';

let mounted: Root | undefined;
afterEach(() => {
  if (mounted) flushSync(() => mounted!.unmount());
  mounted = undefined;
  reset();
});

it('transitions changed targets before publishing their base style, preserves refs and avoids frame updates', async () => {
  const ref = createRef<UiNode>();
  mounted = createRoot();
  const render = (visible: boolean) =>
    flushSync(() =>
      mounted!.render(
        <Animated.View
          ref={ref}
          style={{
            opacity: visible ? 1 : 0,
            transform: [{ translateY: visible ? 0 : 12 }],
          }}
          transition={{ duration: 250, easing: 'ease-out' }}
        >
          <Text>Content</Text>
        </Animated.View>,
      ),
    );
  render(false);
  const node = root.children[0]! as FakeNode;
  expect(ref.current).toBe(node);
  expect(node.animations).toHaveLength(0);
  render(true);
  const first = node.animations[0]!;
  expect(first.before.opacity).toBe(0);
  expect(first.keyframes).toEqual([
    { opacity: 1, transform: [{ translateY: 0 }] },
  ]);
  expect(first.options).toEqual({
    duration: 250,
    easing: 'ease-out',
    fill: 'both',
  });
  expect(node.style.opacity).toBe(1);
  first.finish();
  await first.finished;
  expect(node.animations).toHaveLength(1);
  expect(ref.current).toBe(node);
  render(true); // Fresh equivalent transform arrays must not retarget.
  expect(node.animations).toHaveLength(1);
  render(false);
  expect(node.animations).toHaveLength(2);
  expect(first.playState).toBe('idle');
  flushSync(() => mounted!.unmount());
  expect(node.animations[1]!.playState).toBe('idle');
  expect(ref.current).toBeNull();
});

it('unmounting a parent automatically cancels its animated descendants', () => {
  mounted = createRoot();
  const render = (opacity: number) =>
    flushSync(() =>
      mounted!.render(
        <Animated.View>
          <Animated.View style={{ opacity }}>
            <Text>Child</Text>
          </Animated.View>
        </Animated.View>,
      ),
    );
  render(0);
  render(1);
  const child = root.children[0]!.children[0]! as FakeNode;
  expect(child.animations[0]!.playState).toBe('running');
  flushSync(() => mounted!.unmount());
  expect(child.animations[0]!.playState).toBe('idle');
});

it('holds the captured presentation during a transition delay before publishing the new base style', () => {
  mounted = createRoot();
  const render = (opacity: number) =>
    flushSync(() =>
      mounted!.render(
        <Animated.View
          style={{ opacity }}
          transition={{ duration: 100, delay: 200 }}
        />,
      ),
    );
  render(0);
  render(1);
  const node = root.children[0]! as FakeNode;
  expect(node.animations[0]!.before.opacity).toBe(0);
  expect(node.animations[0]!.options).toEqual({
    duration: 100,
    delay: 200,
    fill: 'both',
  });
  expect(node.style.opacity).toBe(1);
});

it('submits spring transitions with physics options and paint transitions through the same reconciler', () => {
  mounted = createRoot();
  const render = (scale: number, backgroundColor: string) =>
    flushSync(() =>
      mounted!.render(
        <Animated.View
          style={{ transform: [{ scale }], backgroundColor }}
          transition={{ type: 'spring', stiffness: 300, damping: 25, mass: 1 }}
        />,
      ),
    );
  render(1, '#ff0000');
  render(0.95, '#ff0000');
  const node = root.children[0]! as FakeNode;
  expect(node.animations[0]!.options).toMatchObject({
    type: 'spring',
    stiffness: 300,
    damping: 25,
    mass: 1,
    fill: 'both',
  });
  // Paint springs are rejected by the runtimes; use a timing transition for paint.
  flushSync(() =>
    mounted!.render(
      <Animated.View
        style={{ backgroundColor: '#0000ff' }}
        transition={{ duration: 400 }}
      />,
    ),
  );
  expect(node.animations[1]!.keyframes).toEqual([
    { opacity: 1, transform: [], backgroundColor: '#0000ff' },
  ]);
  expect(node.animations[1]!.before.backgroundColor).toBe('#ff0000');
});

it('mounts explicit keyframes before paint, compares their contents, and cleans them up independently of style changes', () => {
  mounted = createRoot();
  const render = (animation = true, duration = 100) =>
    flushSync(() =>
      mounted!.render(
        <Animated.View
          style={{ opacity: 0.2 }}
          animation={
            animation
              ? [{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }]
              : undefined
          }
          transition={{
            duration,
            iterations: Infinity,
            direction: 'alternate',
          }}
        />,
      ),
    );
  render();
  const node = root.children[0]! as FakeNode;
  expect(node.animations).toHaveLength(1);
  expect(node.animations[0]!.before.opacity).toBe(0.2);
  render();
  expect(node.animations).toHaveLength(1);
  render(true, 200);
  expect(node.animations).toHaveLength(2);
  expect(node.animations[0]!.playState).toBe('idle');
  render(false, 200);
  expect(node.animations[1]!.playState).toBe('idle');
});
