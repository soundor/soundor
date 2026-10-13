import { Animated, Text } from '@soundor/react';
import { render, screen, advanceTime } from '@soundor/testing-library/react';
import { getTestRuntime } from '@soundor/vitest';
import { createRef } from 'react';
import type { UiNode } from 'soundor:ui';
import { expect, it } from 'vitest';

it('transitions changed targets before publishing their base style, preserves refs and avoids frame updates', async () => {
  const ref = createRef<UiNode>();
  const component = (visible: boolean) => (
    <Animated.View
      ref={ref}
      accessibilityLabel="Panel"
      style={{
        opacity: visible ? 1 : 0,
        transform: [{ translateY: visible ? 0 : 12 }],
      }}
      transition={{ duration: 250, easing: 'ease-out' }}
    >
      <Text>Content</Text>
    </Animated.View>
  );
  const result = await render(component(false));
  const node = screen.getByLabelText('Panel');
  expect(ref.current).toBe(node);
  expect(node.animations).toHaveLength(0);
  await result.rerender(component(true));
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
  await advanceTime(125);
  expect(Number(node.presentation.opacity)).toBeGreaterThan(0);
  await advanceTime(125);
  await first.finished;
  expect(node.presentation.opacity).toBe(1);
  expect(ref.current).toBe(node);
  await result.rerender(component(true));
  expect(node.animations).toEqual([first]);
  await result.rerender(component(false));
  const second = node.animations[0]!;
  expect(second).not.toBe(first);
  expect(first.playState).toBe('idle');
  expect(node.animations).toHaveLength(1);
  await result.unmount();
  expect(second.playState).toBe('idle');
  expect(ref.current).toBeNull();
});
it('unmounting a parent automatically cancels its animated descendants', async () => {
  const component = (opacity: number) => (
    <Animated.View>
      <Animated.View accessibilityLabel="Child" style={{ opacity }}>
        <Text>Child</Text>
      </Animated.View>
    </Animated.View>
  );
  const result = await render(component(0));
  await result.rerender(component(1));
  const animation = screen.getByLabelText('Child').animations[0]!;
  expect(animation.playState).toBe('running');
  await result.unmount();
  expect(animation.playState).toBe('idle');
  expect(getTestRuntime().activeAnimations.size).toBe(0);
});
it('holds the captured presentation during a transition delay before publishing the new base style', async () => {
  const component = (opacity: number) => (
    <Animated.View
      accessibilityLabel="Delayed"
      style={{ opacity }}
      transition={{ duration: 100, delay: 200 }}
    />
  );
  const result = await render(component(0));
  await result.rerender(component(1));
  const node = screen.getByLabelText('Delayed'),
    animation = node.animations[0]!;
  expect(animation.before.opacity).toBe(0);
  expect(animation.options).toEqual({
    duration: 100,
    delay: 200,
    fill: 'both',
  });
  expect(node.style.opacity).toBe(1);
  await advanceTime(200);
  expect(node.presentation.opacity).toBe(0);
  await advanceTime(50);
  expect(node.presentation.opacity).toBeCloseTo(0.5);
  await advanceTime(50);
  expect(node.presentation.opacity).toBe(1);
});
it('submits spring transitions with physics options and paint transitions through the same reconciler', async () => {
  const component = (scale: number, backgroundColor: string) => (
    <Animated.View
      accessibilityLabel="Spring"
      style={{ transform: [{ scale }], backgroundColor }}
      transition={{ type: 'spring', stiffness: 300, damping: 25, mass: 1 }}
    />
  );
  const result = await render(component(1, '#ff0000'));
  await result.rerender(component(0.95, '#ff0000'));
  const node = screen.getByLabelText('Spring'),
    spring = node.animations[0]!;
  expect(spring.options).toMatchObject({
    type: 'spring',
    stiffness: 300,
    damping: 25,
    mass: 1,
    fill: 'both',
  });
  await advanceTime(2000);
  expect(node.presentation.transform).toEqual([{ scale: 0.95 }]);
  await result.rerender(
    <Animated.View
      accessibilityLabel="Spring"
      style={{ backgroundColor: '#0000ff' }}
      transition={{ duration: 400 }}
    />,
  );
  const paint = node.animations[0]!;
  expect(spring.playState).toBe('idle');
  expect(paint.keyframes).toEqual([
    { opacity: 1, transform: [], backgroundColor: '#0000ff' },
  ]);
  expect(paint.before.backgroundColor).toBe('#ff0000');
  await advanceTime(400);
  expect(node.presentation.backgroundColor).toBe('#0000ff');
});
it('mounts explicit keyframes before paint, compares their contents, and cleans them up independently of style changes', async () => {
  const component = (animation = true, duration = 100) => (
    <Animated.View
      accessibilityLabel="Loop"
      style={{ opacity: 0.2 }}
      animation={
        animation
          ? [{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }]
          : undefined
      }
      transition={{ duration, iterations: Infinity, direction: 'alternate' }}
    />
  );
  const result = await render(component());
  const node = screen.getByLabelText('Loop'),
    first = node.animations[0]!;
  expect(first.before.opacity).toBe(0.2);
  await result.rerender(component());
  expect(node.animations).toEqual([first]);
  await result.rerender(component(true, 200));
  const second = node.animations[0]!;
  expect(first.playState).toBe('idle');
  expect(second).not.toBe(first);
  expect(node.animations).toHaveLength(1);
  await result.rerender(component(false, 200));
  expect(second.playState).toBe('idle');
  expect(node.animations).toHaveLength(0);
});

it('runs delayed sequence and parallel programs through Animated.View', async () => {
  const { effect, sequence, parallel, delay } = await import('soundor:ui');
  const ref = createRef<UiNode>();
  const result = await render(
    <Animated.View
      ref={ref}
      accessibilityLabel="Program"
      style={{ opacity: 0, transform: [{ translateX: 0 }] }}
    />,
  );
  const program = sequence(
    [
      delay(50),
      effect(ref.current!, [{ opacity: 0.5 }], { duration: 50 }),
      parallel([
        effect(ref.current!, [{ opacity: 1 }], { duration: 100 }),
        effect(ref.current!, [{ transform: [{ translateX: 20 }] }], {
          duration: 100,
        }),
      ]),
    ],
    { fill: 'forwards' },
  );
  await result.rerender(
    <Animated.View
      ref={ref}
      accessibilityLabel="Program"
      style={{ opacity: 0, transform: [{ translateX: 0 }] }}
      animation={program}
    />,
  );
  const node = screen.getByLabelText('Program'),
    animation = node.animations[0]!;
  await advanceTime(100);
  expect(node.presentation.opacity).toBeCloseTo(0.5);
  await advanceTime(50);
  expect(node.presentation.opacity).toBeCloseTo(0.75);
  expect(node.presentation.transform).toEqual([{ translateX: 10 }]);
  await advanceTime(50);
  await animation.finished;
  expect(node.presentation.opacity).toBe(1);
  expect(node.presentation.transform).toEqual([{ translateX: 20 }]);
  await result.unmount();
  expect(animation.playState).toBe('idle');
});
