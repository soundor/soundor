// soundor:ui's pressable(): presses with the pointer, the keyboard or
// assistive technology, long presses, and the state they put a node in, as
// the JUCE runtime has them (ui.js).

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
  onLongPress?: (event: PointerEvent | AccessibilityActionEvent) => void;
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
    } else if (
      event.actionName === 'longpress' &&
      handlers.onLongPress !== undefined
    ) {
      event.preventDefault();
      handlers.onLongPress(event);
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
