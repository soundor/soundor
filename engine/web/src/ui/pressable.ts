// soundor:ui's pressable(): presses with the pointer, the keyboard or
// assistive technology, long presses, and the state they put a node in, as
// the native runtime has them (ui.js).

import type {
  AccessibilityActionEvent,
  FocusEvent,
  KeyboardEvent,
  PointerEvent,
} from './events.ts';
import { UiNode } from './node.ts';

export interface PressableState {
  readonly pressed: boolean;
  readonly hovered: boolean;
  readonly focused: boolean;
  readonly focusVisible: boolean;
}

export interface PressableHandlers {
  onPress?: (
    event: PointerEvent | KeyboardEvent | AccessibilityActionEvent,
  ) => void;
  onLongPress?: (event: PointerEvent) => void;
  delayLongPress?: number;
  onPressIn?: (event: PointerEvent) => void;
  onPressOut?: (event: PointerEvent) => void;
  onHoverIn?: (event: PointerEvent) => void;
  onHoverOut?: (event: PointerEvent) => void;
  onStateChange?: (state: PressableState) => void;
}

/**
 * Makes `node` pressable: press with the primary button (released over it)
 * or, when focused, with Enter or Space; hold it for a long press. Reports
 * the pressed, hovered, focused and focus-visible state as it changes.
 * Returns a function that undoes it.
 */
export function pressable(
  node: UiNode,
  handlers: PressableHandlers = {},
): () => void {
  if (!(node instanceof UiNode)) {
    throw new TypeError('node must be a UiNode');
  }
  const state = {
    pressed: false,
    hovered: false,
    focused: node.focused,
    focusVisible: node.focusVisible,
  };
  const update = (change: Partial<PressableState>): void => {
    const next = { ...state, ...change };
    if (
      next.pressed === state.pressed &&
      next.hovered === state.hovered &&
      next.focused === state.focused &&
      next.focusVisible === state.focusVisible
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

  const view = UiNode.viewOf(node);
  if (handlers.delayLongPress !== undefined)
    controller.signal.addEventListener(
      'abort',
      view.gestures.setDelay(node, handlers.delayLongPress),
    );

  on<PointerEvent>('pointerdown', (event) => {
    if (event.button !== 0) return;
    update({ pressed: true });
    handlers.onPressIn?.(event);
  });
  if (handlers.onLongPress !== undefined)
    on<PointerEvent>('longpress', (event) => {
      if (event.pointerType !== '') view.suppressPointerClick(event.pointerId);
      handlers.onLongPress?.(event);
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
  on<PointerEvent>('click', (event) => {
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
  on<FocusEvent>('focus', (event) =>
    update({ focused: true, focusVisible: event.focusVisible }),
  );
  on('blur', () => update({ focused: false, focusVisible: false }));
  on<FocusEvent>('focusvisiblechange', (event) =>
    update({ focusVisible: event.focusVisible }),
  );
  // Assistive technology presses without the pointer or the keyboard.
  on<AccessibilityActionEvent>('accessibilityaction', (event) => {
    if (event.target !== node || event.defaultPrevented) return;
    if (event.actionName === 'activate') {
      event.preventDefault();
      handlers.onPress?.(event);
    }
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
