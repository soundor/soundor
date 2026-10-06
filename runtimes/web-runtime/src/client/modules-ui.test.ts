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
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { uiView } from './context';
import type { PressableState } from './modules/ui';
import type { LayoutRect, Style } from './ui/types';

describe('soundor:ui', () => {
  it('declares the same shapes as the contract', () => {
    expectTypeOf<Style>().toEqualTypeOf<Contract.Style>();
    expectTypeOf<LayoutRect>().toEqualTypeOf<Contract.LayoutRect>();
    expectTypeOf<PressableState>().toEqualTypeOf<Contract.PressableState>();
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

  it('reports focus in its state, from focus and blur', () => {
    const node = createView();
    const other = createView();
    root.appendChild(node);
    root.appendChild(other);
    other.focusable = true;
    const states: string[] = [];
    const undo = pressable(node, {
      onStateChange: (state) => states.push(JSON.stringify(state)),
    });
    node.focus();
    other.focus();
    expect(states).toEqual([
      '{"pressed":false,"hovered":false,"focused":true}',
      '{"pressed":false,"hovered":false,"focused":false}',
    ]);
    undo();
  });

  describe('long press', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function setup(delayLongPress?: number) {
      vi.useFakeTimers();
      const node = createView();
      root.appendChild(node);
      const log: string[] = [];
      const undo = pressable(node, {
        ...(delayLongPress !== undefined && { delayLongPress }),
        onPress: () => log.push('press'),
        onLongPress: (event) => log.push(`long:${event.type}`),
        onPressOut: () => log.push('out'),
      });
      const send = (type: string, init: Record<string, number> = {}) =>
        node.dispatchEvent(
          new PointerEvent(type, { button: 0, bubbles: true, ...init }),
        );
      return { log, send, undo };
    }

    it('fires after 500 ms held, and then is not also a press', () => {
      const { log, send, undo } = setup();
      send('pointerdown');
      vi.advanceTimersByTime(499);
      expect(log).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(log).toEqual(['long:pointerdown']);
      send('pointermove', { clientX: 5 });
      send('pointerup');
      send('click');
      expect(log).toEqual(['long:pointerdown', 'out']);
      // The next press is an ordinary one.
      send('pointerdown');
      send('pointerup');
      send('click');
      expect(log.slice(2)).toEqual(['out', 'press']);
      undo();
    });

    it('waits delayLongPress; not after a short press, a cancel or moving away', () => {
      const { log, send, undo } = setup(50);
      send('pointerdown');
      send('pointerup');
      send('click');
      vi.advanceTimersByTime(100);
      expect(log).toEqual(['out', 'press']);
      log.length = 0;

      send('pointerdown');
      send('pointercancel');
      vi.advanceTimersByTime(100);
      expect(log).toEqual(['out']);
      log.length = 0;

      send('pointerdown', { clientX: 0 });
      send('pointermove', { clientX: 11 });
      vi.advanceTimersByTime(100);
      expect(log).toEqual([]);
      send('pointerup');
      log.length = 0;

      send('pointerdown', { button: 2 });
      vi.advanceTimersByTime(100);
      expect(log).toEqual([]);

      send('pointerdown');
      undo();
      vi.advanceTimersByTime(100);
      expect(log).toEqual([]);
    });
  });

  it('rejects what is not a node', () => {
    expect(() => pressable({} as UiNode)).toThrow(
      new TypeError('node must be a UiNode'),
    );
  });
});
