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
    fill: 'forwards',
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
