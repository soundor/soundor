import {
  createRoot,
  flushSync,
  FocusScope,
  TextInput,
  Text,
  View,
} from '@soundor/react';
import { getTestRuntime } from '@soundor/vitest';
import { root, focusedNode } from 'soundor:ui';
import { test, expect } from 'vitest';
for (const index of [1, 2])
  test(`real renderer with fresh roots ${index}`, () => {
    const renderer = createRoot();
    flushSync(() =>
      renderer.render(
        <FocusScope trapped autoFocus>
          <View>
            <Text>Hello</Text>
            <TextInput value="input" />
          </View>
        </FocusScope>,
      ),
    );
    expect(root.children).toHaveLength(1);
    expect(focusedNode()?.value).toBe('input');
    expect(getTestRuntime().focusedNode()).toBe(focusedNode());
    flushSync(() => renderer.unmount());
    expect(root.children).toEqual([]);
  });
