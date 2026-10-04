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
}

export interface PressableHandlers {
  onPress?: (event: PointerEvent | KeyboardEvent) => void;
  onPressIn?: (event: PointerEvent) => void;
  onPressOut?: (event: PointerEvent) => void;
  onHoverIn?: (event: PointerEvent) => void;
  onHoverOut?: (event: PointerEvent) => void;
  onStateChange?: (state: PressableState) => void;
}

/**
 * Makes `node` pressable: press with the primary button (released over it)
 * or, when focused, with Enter or Space. Reports the pressed and hovered
 * state as it changes. Returns a function that undoes it.
 */
export function pressable(
  node: UiNode,
  handlers: PressableHandlers = {},
): () => void {
  if (!(node instanceof UiNode)) {
    throw new TypeError('node must be a UiNode');
  }
  const state = { pressed: false, hovered: false };
  const update = (change: Partial<PressableState>): void => {
    const next = { ...state, ...change };
    if (next.pressed === state.pressed && next.hovered === state.hovered)
      return;
    Object.assign(state, next);
    handlers.onStateChange?.({ ...state });
  };
  const controller = new AbortController();
  const on = <E extends Event>(type: string, listener: (event: E) => void) =>
    node.addEventListener(type, listener as EventListener, {
      signal: controller.signal,
    });

  on<PointerEvent>('pointerdown', (event) => {
    if (event.button !== 0) return;
    update({ pressed: true });
    handlers.onPressIn?.(event);
  });
  on<PointerEvent>('pointerup', (event) => {
    if (!state.pressed) return;
    update({ pressed: false });
    handlers.onPressOut?.(event);
  });
  on<PointerEvent>('pointercancel', (event) => {
    if (!state.pressed) return;
    update({ pressed: false });
    handlers.onPressOut?.(event);
  });
  on<PointerEvent>('click', (event) => handlers.onPress?.(event));
  on<PointerEvent>('pointerenter', (event) => {
    update({ hovered: true });
    handlers.onHoverIn?.(event);
  });
  on<PointerEvent>('pointerleave', (event) => {
    update({ hovered: false });
    handlers.onHoverOut?.(event);
  });
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
