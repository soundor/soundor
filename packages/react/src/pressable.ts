import {
  useEffect,
  useInsertionEffect,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  pressable,
  type KeyboardEvent,
  type PointerEvent,
  type UiNode,
} from 'soundor:ui';

import {
  withActions,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type AccessibilityRole,
  type AccessibilityState,
} from './accessibility';
import { prioritized } from './host';

/** Whether something pressable is pressed, hovered or focused. */
export interface PressableState {
  /** A press is under way: down, and not yet released or moved away. */
  readonly pressed: boolean;
  /** The pointer is over it. */
  readonly hovered: boolean;
  /** It has keyboard focus. */
  readonly focused: boolean;
  /**
   * It has focus and should show it, as CSS's `:focus-visible`: not when a
   * press gave it focus, until a key is pressed. Draw a focus ring for this.
   */
  readonly focusVisible: boolean;
}

const RESTING: PressableState = Object.freeze({
  pressed: false,
  hovered: false,
  focused: false,
  focusVisible: false,
});

/** What a press does: the callbacks `Pressable` and `usePressable` take. */
export interface PressableOptions {
  /**
   * A press (a click, Enter or Space, or assistive technology's 'activate');
   * not after a long press, when onLongPress is given.
   */
  onPress?: (
    event: PointerEvent | KeyboardEvent | AccessibilityActionEvent,
  ) => void;
  /**
   * Held down `delayLongPress` ms without moving away, or assistive
   * technology's 'longpress'.
   */
  onLongPress?: (event: PointerEvent | AccessibilityActionEvent) => void;
  /** Milliseconds before a press is a long press: 500 by default. */
  delayLongPress?: number;
  /** A press started: the pointer went down on it. */
  onPressIn?: (event: PointerEvent) => void;
  /** A press ended: released, or moved away. */
  onPressOut?: (event: PointerEvent) => void;
  /** The pointer came over it. */
  onHoverIn?: (event: PointerEvent) => void;
  /** The pointer left it. */
  onHoverOut?: (event: PointerEvent) => void;
  /** Not pressable, nor focusable; assistive technology is told it is disabled. */
  disabled?: boolean;
}

export interface UsePressableOptions extends PressableOptions {
  /** Its own accessibility state, to which `disabled` is added. */
  accessibilityState?: AccessibilityState;
  /** Its own accessibility actions, after 'activate' and 'longpress'. */
  accessibilityActions?: readonly AccessibilityActionInfo[];
  /** A ref of your own to the node, as `pressableProps` takes the ref. */
  ref?: Ref<UiNode>;
}

/** What `usePressable` gives: its state, and the props for the node. */
export interface PressableHandle extends PressableState {
  /**
   * For the node that is pressed: spread them on a `View`. Props after the
   * spread override them, such as another `accessibilityRole`.
   */
  pressableProps: {
    ref: (node: UiNode | null) => void;
    accessible: true;
    accessibilityRole: AccessibilityRole;
    accessibilityState: AccessibilityState | undefined;
    accessibilityActions: readonly AccessibilityActionInfo[] | undefined;
    focusable: boolean;
  };
}

const ACTIVATE: AccessibilityActionInfo = { name: 'activate' };
const LONG_PRESS: AccessibilityActionInfo = { name: 'longpress' };

/**
 * What `Pressable` does, for a component of your own: presses, long presses
 * and its state, on whatever node you spread `pressableProps` on.
 *
 *   function Button({ label, onPress }) {
 *     const press = usePressable({ onPress });
 *     return (
 *       <View {...press.pressableProps} style={[styles.button, press.pressed && styles.down]}>
 *         <Text>{label}</Text>
 *       </View>
 *     );
 *   }
 */
export function usePressable(
  options: UsePressableOptions = {},
): PressableHandle {
  const {
    disabled = false,
    delayLongPress,
    accessibilityState,
    accessibilityActions,
  } = options;
  const [node, setNode] = useState<UiNode | null>(null);
  const [state, setState] = useState<PressableState>(RESTING);
  // The latest options, read by listeners installed once per node, and by
  // the ref, which stays the same so that React does not detach it.
  const latest = useRef(options);
  // Commit the options before ref attachment, without exposing an uncommitted render.
  useInsertionEffect(() => {
    latest.current = options;
  });
  const [attach] = useState(() => (value: UiNode | null) => {
    setNode(value);
    const ref = latest.current.ref;
    if (typeof ref === 'function') ref(value);
    else if (ref) ref.current = value;
  });
  const longPresses = options.onLongPress !== undefined;

  useEffect(() => {
    if (node === null || disabled) return undefined;
    // Updates from presses render as promptly as those of event props.
    const call =
      <E extends Event>(name: keyof PressableOptions) =>
      (event: E) =>
        prioritized(event.type, () =>
          (latest.current[name] as ((event: E) => void) | undefined)?.(event),
        );
    const undo = pressable(node, {
      onPress: call('onPress'),
      ...(longPresses && {
        onLongPress: call<PointerEvent | AccessibilityActionEvent>(
          'onLongPress',
        ),
        delayLongPress,
      }),
      onPressIn: call('onPressIn'),
      onPressOut: call('onPressOut'),
      onHoverIn: call('onHoverIn'),
      onHoverOut: call('onHoverOut'),
      onStateChange: (next) => prioritized('press', () => setState(next)),
    });
    return () => {
      undo();
      setState(RESTING);
    };
  }, [node, disabled, latest, longPresses, delayLongPress]);

  return {
    ...state,
    pressableProps: {
      ref: attach,
      accessible: true,
      accessibilityRole: 'button',
      accessibilityState:
        disabled && accessibilityState?.disabled === undefined
          ? { ...accessibilityState, disabled: true }
          : accessibilityState,
      accessibilityActions: disabled
        ? accessibilityActions
        : withActions(
            longPresses ? [ACTIVATE, LONG_PRESS] : [ACTIVATE],
            accessibilityActions,
          ),
      focusable: !disabled,
    },
  };
}
