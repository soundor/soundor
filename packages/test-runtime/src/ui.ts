import { TestEvent, TestNode } from './node';
import type { TestRuntime } from './runtime';
import type {
  AnimationComposition,
  AnimationDescription,
  AnimationEffect,
  AnimationKeyframe,
  AnimationOptions,
  AnimationPlaybackOptions,
  Style,
} from './types';

export function effect(
  target: TestNode,
  keyframes: readonly AnimationKeyframe[],
  options: AnimationOptions = {},
): AnimationEffect {
  return Object.freeze({
    kind: 'effect',
    target,
    keyframes,
    options: Object.freeze({ ...options }),
  });
}
export function sequence(
  children: readonly AnimationDescription[],
  options: AnimationPlaybackOptions = {},
): AnimationComposition {
  return Object.freeze({
    kind: 'sequence',
    children: Object.freeze([...children]),
    options: Object.freeze({ ...options }),
  });
}
export function parallel(
  children: readonly AnimationDescription[],
  options: AnimationPlaybackOptions = {},
): AnimationComposition {
  return Object.freeze({
    kind: 'parallel',
    children: Object.freeze([...children]),
    options: Object.freeze({ ...options }),
  });
}
export function stagger(
  interval: number,
  children: readonly AnimationDescription[],
  options: AnimationPlaybackOptions = {},
): AnimationComposition {
  return Object.freeze({
    kind: 'stagger',
    stagger: interval,
    children: Object.freeze([...children]),
    options: Object.freeze({ ...options }),
  });
}
export function delay(
  duration: number,
  child?: AnimationDescription,
): AnimationDescription {
  const wait = Object.freeze({ kind: 'delay' as const, duration });
  return child === undefined ? wait : sequence([wait, child]);
}
export function repeat(
  child: AnimationDescription,
  iterations = Infinity,
  direction: AnimationOptions['direction'] = 'normal',
): AnimationComposition {
  return sequence([child], { iterations, direction });
}
/** Instance-bound soundor:ui module; no renderer or test-runner dependencies. */
export function createUiModule(runtime: TestRuntime) {
  return {
    root: runtime.root,
    overlayRoot: runtime.overlayRoot,
    UiNode: TestNode,
    PointerEvent: TestEvent,
    KeyboardEvent: TestEvent,
    InputEvent: TestEvent,
    FocusEvent: TestEvent,
    AccessibilityActionEvent: TestEvent,
    WheelEvent: TestEvent,
    createView: (style?: Style) => runtime.create('view', style),
    createText: (text = '', style?: Style) => {
      const node = runtime.create('text', style);
      node.text = text;
      return node;
    },
    createImage: (source = '', style?: Style) => {
      const node = runtime.create('image', style);
      node.source = source;
      return node;
    },
    createScrollView: (style?: Style) => runtime.create('scroll', style),
    createTextInput: (
      options: { value?: string; placeholder?: string; style?: Style } = {},
    ) => {
      const node = runtime.create('input', options.style);
      node.value = options.value ?? '';
      node.placeholder = options.placeholder ?? '';
      return node;
    },
    createCanvas: (style?: Style) => runtime.create('canvas', style),
    pressable: (...args: Parameters<typeof runtime.pressable>) =>
      runtime.pressable(...args),
    focusedNode: () => runtime.focusedNode(),
    clipboard: runtime.clipboard,
    viewSize: () => {
      throw new Error('Layout is unavailable in the simulated Soundor runtime');
    },
    effect,
    sequence,
    parallel,
    stagger,
    delay,
    repeat,
    animate: (
      description: AnimationDescription,
      options: AnimationPlaybackOptions = {},
    ) => runtime.animate(runtime.root, description, options),
    setReducedMotion: (value: boolean) => runtime.setReducedMotion(value),
    prefersReducedMotion: () => runtime.prefersReducedMotion(),
  };
}
