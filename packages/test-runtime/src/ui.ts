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
export interface FontDescriptors {
  weight?: number | 'normal' | 'bold';
  style?: 'normal' | 'italic';
}

function shown(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'number') return String(value);
  if (value === null) return 'null';
  if (typeof value === 'object')
    return (value as object).constructor?.name ?? 'object';
  return typeof value;
}

/** registerFont()'s argument checks, worded as in the runtimes. */
function checkFont(family: unknown, source: unknown, descriptors: unknown) {
  if (typeof family !== 'string' || family === '')
    throw new TypeError(
      `registerFont(): family must be a non-empty string, got ${shown(family)}`,
    );
  if (typeof source !== 'string' || source === '')
    throw new TypeError(
      `registerFont(): source must be a bundled font (import font from './font.ttf'), got ${shown(source)}`,
    );
  if (descriptors === null || typeof descriptors !== 'object')
    throw new TypeError(
      `registerFont(): descriptors must be an object, got ${shown(descriptors)}`,
    );
  const given = descriptors as { weight?: unknown; style?: unknown };
  const raw = given.weight ?? 400;
  const weight =
    raw === 'normal'
      ? 400
      : raw === 'bold'
        ? 700
        : typeof raw === 'number' || typeof raw === 'string'
          ? Number(raw)
          : Number.NaN;
  if (!(weight >= 1 && weight <= 1000))
    throw new TypeError(
      `registerFont(): weight must be a weight from 1 to 1000, 'normal' or 'bold', got ${shown(raw)}`,
    );
  const style = given.style ?? 'normal';
  if (style !== 'normal' && style !== 'italic')
    throw new TypeError(
      `registerFont(): style must be 'normal' or 'italic', got ${shown(style)}`,
    );
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
    exitPointerLock: () => runtime.exitPointerLock(),
    pointerLockNode: () => runtime.pointerLockNode(),
    clipboard: runtime.clipboard,
    /** The simulated size (nothing is laid out at it): the same object until set. */
    viewSize: () => runtime.viewSize(),
    subscribeViewSize: (
      listener: Parameters<TestRuntime['subscribeViewSize']>[0],
    ) => runtime.subscribeViewSize(listener),
    /** Checks its arguments as the runtimes do; there is no text to set in it. */
    registerFont: (
      family: string,
      source: string,
      descriptors: FontDescriptors = {},
    ): Promise<void> => {
      checkFont(family, source, descriptors);
      return Promise.resolve();
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
