import {
  createRoot,
  flushSync,
  FocusScope,
  TextInput,
  Text,
  View,
  useAnimationFrame,
} from '@soundor/react';
import { getTestRuntime } from '@soundor/vitest';
import { root, focusedNode } from 'soundor:ui';
import { test, expect } from 'vitest';
for (const index of [1, 2])
  test(`real renderer with fresh roots ${index}`, () => {
    const renderer = createRoot();
    const times: number[] = [];
    function Frames() {
      useAnimationFrame((time) => {
        times.push(time);
      });
      return null;
    }
    flushSync(() =>
      renderer.render(
        <FocusScope trapped autoFocus>
          <View>
            <Frames />
            <Text>Hello</Text>
            <TextInput value="input" />
          </View>
        </FocusScope>,
      ),
    );
    expect(root.children).toHaveLength(1);
    expect(focusedNode()?.value).toBe('input');
    expect(getTestRuntime().focusedNode()).toBe(focusedNode());
    getTestRuntime().advanceTime(34);
    expect(times).toHaveLength(2);
    expect(times[0]).toBeCloseTo(1000 / 60);
    flushSync(() => renderer.unmount());
    expect(getTestRuntime().clock.pending).toBe(0);
    expect(root.children).toEqual([]);
  });
