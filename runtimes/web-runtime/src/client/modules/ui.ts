// `soundor:ui` in the browser: the plugin view's node tree, drawn with DOM
// elements in the host's plugin viewport. The same plugin code (and
// @soundor/react) runs on it as on the JUCE runtime's Skia renderer.

import { uiView } from '../context';
import type { KeyboardEvent, PointerEvent } from '../ui/events';
import { UiNode } from '../ui/node';
import type { Style } from '../ui/types';

const view = uiView();

/** The view's root node; it always fills the view. */
export const root = view.root;

/** A new, detached view: a box laid out with flexbox. */
export function createView(style?: Style): UiNode {
  const node = view.createNode('view');
  if (style !== undefined) node.style = style;
  return node;
}

/** A new, detached text node. */
export function createText(text = '', style?: Style): UiNode {
  const node = view.createNode('text');
  if (text !== '') node.text = text;
  if (style !== undefined) node.style = style;
  return node;
}

/** A new, detached image showing a bundled asset. */
export function createImage(source = '', style?: Style): UiNode {
  const node = view.createNode('image');
  if (source !== '') node.source = source;
  if (style !== undefined) node.style = style;
  return node;
}

/** A new, detached view whose children scroll (by wheel, or scrollTo()). */
export function createScrollView(style?: Style): UiNode {
  const node = view.createNode('scroll');
  if (style !== undefined) node.style = style;
  return node;
}

/** A new, detached single-line text input. It is focusable. */
export function createTextInput(
  options: { value?: string; placeholder?: string; style?: Style } = {},
): UiNode {
  const node = view.createNode('input');
  if (options.value !== undefined) node.value = options.value;
  if (options.placeholder !== undefined) node.placeholder = options.placeholder;
  if (options.style !== undefined) node.style = options.style;
  return node;
}

/** The view's size in logical pixels, and device pixels per logical pixel. */
export function viewSize(): { width: number; height: number; scale: number } {
  return view.size();
}

/** The node that has keyboard focus, if any. */
export function focusedNode(): UiNode | null {
  return view.focusedNode();
}

/** The clipboard's text (navigator.clipboard's shape). */
export const clipboard = Object.freeze({
  readText: (): Promise<string> => view.readClipboard(),
  writeText: (text: string): Promise<void> => view.writeClipboard(String(text)),
});

export interface PressableState {
  readonly pressed: boolean;
  readonly hovered: boolean;
  readonly focused: boolean;
}

export interface PressableHandlers {
  onPress?: (event: PointerEvent | KeyboardEvent) => void;
  onLongPress?: (event: PointerEvent) => void;
  delayLongPress?: number;
  onPressIn?: (event: PointerEvent) => void;
  onPressOut?: (event: PointerEvent) => void;
  onHoverIn?: (event: PointerEvent) => void;
  onHoverOut?: (event: PointerEvent) => void;
  onStateChange?: (state: PressableState) => void;
}

/** How long a press lasts before it is a long press, by default (ms). */
const LONG_PRESS_DELAY = 500;
/** How far a press may move (logical pixels) and still be a long press. */
const LONG_PRESS_SLOP = 10;

/**
 * Makes `node` pressable: press with the primary button (released over it)
 * or, when focused, with Enter or Space; hold it for a long press. Reports
 * the pressed, hovered and focused state as it changes. Returns a function
 * that undoes it.
 */
export function pressable(
  node: UiNode,
  handlers: PressableHandlers = {},
): () => void {
  if (!(node instanceof UiNode)) {
    throw new TypeError('node must be a UiNode');
  }
  const state = { pressed: false, hovered: false, focused: node.focused };
  const update = (change: Partial<PressableState>): void => {
    const next = { ...state, ...change };
    if (
      next.pressed === state.pressed &&
      next.hovered === state.hovered &&
      next.focused === state.focused
    )
      return;
    Object.assign(state, next);
    handlers.onStateChange?.({ ...state });
  };
  const controller = new AbortController();
  const on = <E extends Event>(type: string, listener: (event: E) => void) =>
    node.addEventListener(type, listener as EventListener, {
      signal: controller.signal,
    });

  // A long press: the press held, close to where it started, until a timer.
  let longPress: {
    timer: ReturnType<typeof setTimeout>;
    x: number;
    y: number;
  } | null = null;
  let longPressed = false;
  const cancelLongPress = (): void => {
    if (longPress !== null) clearTimeout(longPress.timer);
    longPress = null;
  };
  controller.signal.addEventListener('abort', cancelLongPress);

  on<PointerEvent>('pointerdown', (event) => {
    if (event.button !== 0) return;
    cancelLongPress();
    longPressed = false;
    update({ pressed: true });
    handlers.onPressIn?.(event);
    if (handlers.onLongPress !== undefined && state.pressed) {
      const delay = handlers.delayLongPress ?? LONG_PRESS_DELAY;
      longPress = {
        x: event.pageX,
        y: event.pageY,
        timer: setTimeout(() => {
          longPress = null;
          if (!state.pressed) return;
          longPressed = true;
          handlers.onLongPress?.(event);
        }, delay),
      };
    }
  });
  on<PointerEvent>('pointermove', (event) => {
    if (longPress === null) return;
    const moved = Math.hypot(
      event.pageX - longPress.x,
      event.pageY - longPress.y,
    );
    if (moved > LONG_PRESS_SLOP) cancelLongPress();
  });
  on<PointerEvent>('pointerup', (event) => {
    cancelLongPress();
    if (!state.pressed) return;
    update({ pressed: false });
    handlers.onPressOut?.(event);
  });
  on<PointerEvent>('pointercancel', (event) => {
    cancelLongPress();
    longPressed = false;
    if (!state.pressed) return;
    update({ pressed: false });
    handlers.onPressOut?.(event);
  });
  on<PointerEvent>('click', (event) => {
    // A long press is not also a press.
    if (longPressed) {
      longPressed = false;
      return;
    }
    handlers.onPress?.(event);
  });
  on<PointerEvent>('pointerenter', (event) => {
    update({ hovered: true });
    handlers.onHoverIn?.(event);
  });
  on<PointerEvent>('pointerleave', (event) => {
    update({ hovered: false });
    handlers.onHoverOut?.(event);
  });
  on('focus', () => update({ focused: true }));
  on('blur', () => update({ focused: false }));
  on<KeyboardEvent>('keydown', (event) => {
    if (event.target !== node || event.repeat) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handlers.onPress?.(event);
  });
  node.focusable = true;
  return () => controller.abort();
}

export { UiNode };
export {
  FocusEvent,
  InputEvent,
  KeyboardEvent,
  PointerEvent,
  WheelEvent,
} from '../ui/events';
