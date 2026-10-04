// @vitest-environment happy-dom
// Plugin code's view of soundor:ui, imported as a plugin bundle imports it.

import type * as Contract from 'soundor:ui';
import {
  clipboard,
  createImage,
  createScrollView,
  createText,
  createTextInput,
  createView,
  focusedNode,
  KeyboardEvent,
  PointerEvent,
  pressable,
  root,
  UiNode,
  viewSize,
} from 'soundor:ui';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { uiView } from './context';
import type { LayoutRect, Style } from './ui/types';

describe('soundor:ui', () => {
  it('declares the same shapes as the contract', () => {
    expectTypeOf<Style>().toEqualTypeOf<Contract.Style>();
    expectTypeOf<LayoutRect>().toEqualTypeOf<Contract.LayoutRect>();
  });

  it('is the page view: its root and its nodes', () => {
    expect(root).toBe(uiView().root);
    expect(root).toBeInstanceOf(UiNode);
    expect(root).toBeInstanceOf(EventTarget);
    expect(root.isConnected).toBe(true);
    const box = createView({ padding: 4 });
    const text = createText('Hi', { color: 'red' });
    const input = createTextInput({ value: 'v', placeholder: 'p' });
    const image = createImage('0123456789abcdef.png' as SoundorAsset);
    const scroll = createScrollView({ flex: 1 });
    expect([box, text, input, image, scroll].map((node) => node.type)).toEqual([
      'view',
      'text',
      'input',
      'image',
      'scroll',
    ]);
    expect(text.text).toBe('Hi');
    expect(box.style).toEqual({ padding: 4 });
    expect([input.value, input.placeholder, input.focusable]).toEqual([
      'v',
      'p',
      true,
    ]);
    expect(image.source).toBe('0123456789abcdef.png');
    expect(viewSize()).toMatchObject({ width: 0, height: 0 });
    expect(focusedNode()).toBeNull();
  });

  it('copies through its clipboard', async () => {
    await clipboard.writeText('text');
    expect(await clipboard.readText()).toBe('text');
  });
});

describe('pressable', () => {
  it('reports presses, press state and hover; undoes itself', () => {
    const node = createView();
    root.appendChild(node);
    const onPress = vi.fn<(event: unknown) => void>();
    const states: string[] = [];
    const undo = pressable(node, {
      onPress,
      onStateChange: (state) =>
        states.push(
          `${state.pressed ? 'pressed' : 'up'}/${state.hovered ? 'hover' : 'out'}`,
        ),
    });
    expect(node.focusable).toBe(true);

    node.dispatchEvent(new PointerEvent('pointerenter'));
    node.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, bubbles: true }),
    );
    node.dispatchEvent(
      new PointerEvent('pointerup', { button: 0, bubbles: true }),
    );
    node.dispatchEvent(new PointerEvent('click', { button: 0, bubbles: true }));
    node.dispatchEvent(
      new PointerEvent('pointerdown', { button: 2, bubbles: true }),
    );
    node.dispatchEvent(new PointerEvent('pointerleave'));
    expect(states).toEqual(['up/hover', 'pressed/hover', 'up/hover', 'up/out']);
    expect(onPress).toHaveBeenCalledTimes(1);

    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    node.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    node.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', repeat: true }),
    );
    expect(onPress).toHaveBeenCalledTimes(2);

    undo();
    node.dispatchEvent(new PointerEvent('click', { button: 0 }));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('rejects what is not a node', () => {
    expect(() => pressable({} as UiNode)).toThrow(
      new TypeError('node must be a UiNode'),
    );
  });
});
