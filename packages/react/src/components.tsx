import {
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import {
  pressable,
  type FocusEvent,
  type InputEvent,
  type KeyboardEvent,
  type PointerEvent,
  type Style,
  type UiNode,
  type AnimationOptions,
  type AnimationKeyframe,
  type AnimationDescription,
  type WheelEvent,
  type Asset,
} from 'soundor:ui';

import {
  withActions,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type AccessibilityProps,
} from './accessibility';
import { ScopeContext } from './focus';
import { TRANSITION_PROP, ANIMATION_PROP } from './host';
import { HostTypes, prioritized, SCOPE_PROP } from './host';
import type { StyleProp } from './style';

/** Event props every component takes; `…Capture` runs in the capture phase. */
export interface EventProps {
  /** A button went down over the node (mouse, pen or touch). */
  onPointerDown?: (event: PointerEvent) => void;
  onPointerDownCapture?: (event: PointerEvent) => void;
  /** The pointer moved over the node, or anywhere while the node captures it. */
  onPointerMove?: (event: PointerEvent) => void;
  onPointerMoveCapture?: (event: PointerEvent) => void;
  /** A button went up. */
  onPointerUp?: (event: PointerEvent) => void;
  onPointerUpCapture?: (event: PointerEvent) => void;
  /** A press ended without a release: the platform cancelled the pointer. */
  onPointerCancel?: (event: PointerEvent) => void;
  /** The pointer entered the node's box; does not bubble. */
  onPointerEnter?: (event: PointerEvent) => void;
  /** The pointer left the node's box; does not bubble. */
  onPointerLeave?: (event: PointerEvent) => void;
  /** The primary button went down and up on the node. */
  onClick?: (event: PointerEvent) => void;
  onClickCapture?: (event: PointerEvent) => void;
  /**
   * The secondary button went down: where to open a custom menu
   * (`event.pageX/pageY`). preventDefault() keeps a browser's own away.
   */
  onContextMenu?: (event: PointerEvent) => void;
  onContextMenuCapture?: (event: PointerEvent) => void;
  /** A wheel or trackpad scrolled over the node. */
  onWheel?: (event: WheelEvent) => void;
  onWheelCapture?: (event: WheelEvent) => void;
  /** A key went down while the node, or a node in it, had focus. */
  onKeyDown?: (event: KeyboardEvent) => void;
  onKeyDownCapture?: (event: KeyboardEvent) => void;
  /** A key went up while the node, or a node in it, had focus. */
  onKeyUp?: (event: KeyboardEvent) => void;
  /** The node took keyboard focus; does not bubble. */
  onFocus?: (event: FocusEvent) => void;
  /** The node lost keyboard focus; does not bubble. */
  onBlur?: (event: FocusEvent) => void;
}

/** Props for developer tools: DevTools and Soundor Driver. */
export interface DebugProps {
  /**
   * A name DevTools shows and Soundor Driver finds the node by
   * (`getByDebugId`); at most 128 characters. Not shown, nor read to
   * assistive technology.
   */
  debugId?: string;
}

export interface ViewProps extends EventProps, AccessibilityProps, DebugProps {
  /** Layout and paint: flexbox (a column by default), spacing, colors. */
  style?: StyleProp;
  /** Takes focus when pressed or tabbed to. */
  focusable?: boolean;
  /** The view's `soundor:ui` node: its layout, bounds, focus, animations. */
  ref?: Ref<UiNode>;
  children?: ReactNode;
}

/** Props for a host element: with the FocusScope it is rendered in. */
function useHostProps<P extends object>(props: P): P {
  return { ...props, [SCOPE_PROP]: useContext(ScopeContext) };
}

/** A box laid out with flexbox: the building block. */
export function View(props: ViewProps) {
  return createElement(HostTypes.View, useHostProps(props));
}

export type TimingTransition = AnimationOptions & { type?: 'timing' };
export type SpringTransition = AnimationOptions & { type: 'spring' };
export type AnimationTransition = TimingTransition | SpringTransition;
export interface AnimatedViewProps extends ViewProps {
  /**
   * How opacity and transform changes animate: timing (300 ms linear by
   * default) or `type: 'spring'`; and the playback of `animation`.
   */
  transition?: AnimationTransition;
  /** Keyframes or a composed description, submitted when its contents change. */
  animation?: readonly AnimationKeyframe[] | AnimationDescription;
}
function AnimatedView({
  transition = {},
  animation,
  ...props
}: AnimatedViewProps) {
  return createElement(
    HostTypes.View,
    useHostProps({
      ...props,
      [TRANSITION_PROP]: transition,
      [ANIMATION_PROP]: animation,
    }),
  );
}
/** Declarative transitions: only target changes reach the reconciler. */
export const Animated = Object.freeze({ View: AnimatedView });

/**
 * Accessibility props of a <Text> nested in another apply to neither: the
 * outermost <Text> is read as one text.
 */
export interface TextProps extends EventProps, AccessibilityProps, DebugProps {
  /** Font, color and alignment, besides a view's layout and paint. */
  style?: StyleProp;
  /** At most this many lines. */
  numberOfLines?: number;
  /** The text's `soundor:ui` node. */
  ref?: Ref<UiNode>;
  /** Strings, numbers and nested <Text>, shown as one run of text. */
  children?: ReactNode;
}

/** Text. Strings must be inside a <Text>. */
export function Text(props: TextProps) {
  return createElement(HostTypes.Text, useHostProps(props));
}

/**
 * Images are decorative to assistive technology unless given a label (or
 * made accessible, or given a role).
 */
export interface ImageProps extends EventProps, AccessibilityProps, DebugProps {
  /** A bundled image: `import logo from './logo.png'`. */
  source: Asset;
  /** Its box; `resizeMode` says how the image fills it. */
  style?: StyleProp;
  /** The image's `soundor:ui` node. */
  ref?: Ref<UiNode>;
}

/** A bundled image, sized by its pixels unless styled. */
export function Image(props: ImageProps) {
  return createElement(HostTypes.Image, useHostProps(props));
}

/**
 * Canvases are decorative to assistive technology unless given a label (or
 * made accessible, or given a role), like images.
 */
export interface CanvasProps
  extends EventProps, AccessibilityProps, DebugProps {
  /**
   * The drawing buffer's size in pixels (300 by 150 by default). Changing
   * either clears the canvas; draw again after (e.g. in an effect that
   * depends on them).
   */
  width?: number;
  /** The drawing buffer's height in pixels: see `width`. */
  height?: number;
  /** Its box, which the buffer is scaled to: the buffer's size unless set. */
  style?: StyleProp;
  /** The canvas node: draw with `ref.current.getContext('2d')`. */
  ref?: Ref<UiNode>;
}

/** A canvas code draws on, sized by its drawing buffer unless styled. */
export function Canvas(props: CanvasProps) {
  return createElement(HostTypes.Canvas, useHostProps(props));
}

export interface ScrollViewProps extends ViewProps {
  /** The style of the box inside that holds the children and scrolls. */
  contentContainerStyle?: StyleProp;
  /** It scrolled; read the node's `scrollTop`/`scrollLeft`. */
  onScroll?: (event: Event) => void;
}

/** A view whose content scrolls (wheel, or the node's scrollTo()). */
export function ScrollView({
  contentContainerStyle,
  children,
  ...props
}: ScrollViewProps) {
  const scope = useContext(ScopeContext);
  return createElement(
    HostTypes.ScrollView,
    { ...props, [SCOPE_PROP]: scope },
    createElement(
      HostTypes.View,
      { style: contentContainerStyle, [SCOPE_PROP]: scope },
      children,
    ),
  );
}

export interface TextInputProps
  extends EventProps, AccessibilityProps, DebugProps {
  /** Controlled text; pair it with onChangeText. */
  value?: string;
  /** The initial text of an uncontrolled input. */
  defaultValue?: string;
  /** Shown, dimmed, while the text is empty. */
  placeholder?: string;
  /** Its box and its text's font and color. */
  style?: StyleProp;
  /** After every edit, with the new text. */
  onChangeText?: (text: string) => void;
  /** On Enter, with the text. */
  onSubmitEditing?: (text: string) => void;
  /** After every edit: the `soundor:ui` event onChangeText comes from. */
  onInput?: (event: InputEvent) => void;
  /** The text was committed: Enter, or losing focus. */
  onChange?: (event: Event) => void;
  /** The input's `soundor:ui` node: focus() it, read its value. */
  ref?: Ref<UiNode>;
}

/** A single-line text input. */
export function TextInput(props: TextInputProps) {
  return createElement(HostTypes.TextInput, useHostProps(props));
}

/** What a Pressable's `style` and `children` functions are given. */
export interface PressableState {
  /** A press is under way: down, and not yet released or moved away. */
  readonly pressed: boolean;
  /** The pointer is over it. */
  readonly hovered: boolean;
  /** It has keyboard focus. */
  readonly focused: boolean;
}

const RESTING: PressableState = Object.freeze({
  pressed: false,
  hovered: false,
  focused: false,
});

export interface PressableProps extends Omit<ViewProps, 'style' | 'children'> {
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
  /** A style, or a function of its state: pressed, hovered, focused. */
  style?: StyleProp | ((state: PressableState) => StyleProp);
  /** Children, or a function of its state: pressed, hovered, focused. */
  children?: ReactNode | ((state: PressableState) => ReactNode);
}

const ACTIVATE: AccessibilityActionInfo = { name: 'activate' };
const LONG_PRESS: AccessibilityActionInfo = { name: 'longpress' };

/**
 * A view that responds to presses: a click, or Enter/Space while focused,
 * and long presses. `style` and `children` may depend on whether it is
 * pressed, hovered or focused.
 *
 * To assistive technology it is one element, a button unless given another
 * role, labelled by its text; it offers 'activate' (onPress) and, with
 * onLongPress, 'longpress', and is disabled while `disabled`.
 */
export function Pressable({
  onPress,
  onLongPress,
  delayLongPress,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  disabled = false,
  style,
  children,
  ref,
  accessible = true,
  accessibilityRole = 'button',
  accessibilityState,
  accessibilityActions,
  ...props
}: PressableProps) {
  const [node, setNode] = useState<UiNode | null>(null);
  const [state, setState] = useState<PressableState>(RESTING);
  // The latest handlers, read by listeners installed once per node.
  const [handlers] = useState(() => ({ current: {} as PressableProps }));
  handlers.current = {
    onPress,
    onLongPress,
    onPressIn,
    onPressOut,
    onHoverIn,
    onHoverOut,
  };
  const longPresses = onLongPress !== undefined;

  useEffect(() => {
    if (node === null || disabled) return undefined;
    // Updates from presses render as promptly as those of event props.
    const call =
      <E extends Event>(name: keyof typeof handlers.current) =>
      (event: E) =>
        prioritized(event.type, () =>
          (handlers.current[name] as ((event: E) => void) | undefined)?.(event),
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
  }, [node, disabled, handlers, longPresses, delayLongPress]);

  const attach = (value: UiNode | null) => {
    setNode(value);
    if (typeof ref === 'function') ref(value);
    else if (ref) ref.current = value;
  };
  const scope = useContext(ScopeContext);
  return createElement(
    HostTypes.View,
    {
      ...props,
      [SCOPE_PROP]: scope,
      ref: attach,
      accessible,
      accessibilityRole,
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
      style: typeof style === 'function' ? style(state) : style,
    },
    typeof children === 'function' ? children(state) : children,
  );
}

export type { Style };
