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
  type WheelEvent,
} from 'soundor:ui';

import {
  withActions,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type AccessibilityProps,
} from './accessibility';
import { ScopeContext } from './focus';
import { HostTypes, prioritized, SCOPE_PROP } from './host';
import type { StyleProp } from './style';

/** Event props every component takes; `…Capture` runs in the capture phase. */
export interface EventProps {
  onPointerDown?: (event: PointerEvent) => void;
  onPointerDownCapture?: (event: PointerEvent) => void;
  onPointerMove?: (event: PointerEvent) => void;
  onPointerMoveCapture?: (event: PointerEvent) => void;
  onPointerUp?: (event: PointerEvent) => void;
  onPointerUpCapture?: (event: PointerEvent) => void;
  onPointerCancel?: (event: PointerEvent) => void;
  onPointerEnter?: (event: PointerEvent) => void;
  onPointerLeave?: (event: PointerEvent) => void;
  onClick?: (event: PointerEvent) => void;
  onClickCapture?: (event: PointerEvent) => void;
  /**
   * The secondary button went down: where to open a custom menu
   * (`event.pageX/pageY`). preventDefault() keeps a browser's own away.
   */
  onContextMenu?: (event: PointerEvent) => void;
  onContextMenuCapture?: (event: PointerEvent) => void;
  onWheel?: (event: WheelEvent) => void;
  onWheelCapture?: (event: WheelEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onKeyDownCapture?: (event: KeyboardEvent) => void;
  onKeyUp?: (event: KeyboardEvent) => void;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
}

export interface ViewProps extends EventProps, AccessibilityProps {
  style?: StyleProp;
  /** Takes focus when pressed or tabbed to. */
  focusable?: boolean;
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

/**
 * Accessibility props of a <Text> nested in another apply to neither: the
 * outermost <Text> is read as one text.
 */
export interface TextProps extends EventProps, AccessibilityProps {
  style?: StyleProp;
  /** At most this many lines. */
  numberOfLines?: number;
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
export interface ImageProps extends EventProps, AccessibilityProps {
  /** A bundled image: `import logo from './logo.png'`. */
  source: SoundorAsset;
  style?: StyleProp;
  ref?: Ref<UiNode>;
}

/** A bundled image, sized by its pixels unless styled. */
export function Image(props: ImageProps) {
  return createElement(HostTypes.Image, useHostProps(props));
}

export interface ScrollViewProps extends ViewProps {
  /** The style of the box inside that holds the children and scrolls. */
  contentContainerStyle?: StyleProp;
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

export interface TextInputProps extends EventProps, AccessibilityProps {
  /** Controlled text; pair it with onChangeText. */
  value?: string;
  /** The initial text of an uncontrolled input. */
  defaultValue?: string;
  placeholder?: string;
  style?: StyleProp;
  /** After every edit, with the new text. */
  onChangeText?: (text: string) => void;
  /** On Enter, with the text. */
  onSubmitEditing?: (text: string) => void;
  onInput?: (event: InputEvent) => void;
  /** The text was committed: Enter, or losing focus. */
  onChange?: (event: Event) => void;
  ref?: Ref<UiNode>;
}

/** A single-line text input. */
export function TextInput(props: TextInputProps) {
  return createElement(HostTypes.TextInput, useHostProps(props));
}

export interface PressableState {
  readonly pressed: boolean;
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
  onPressIn?: (event: PointerEvent) => void;
  onPressOut?: (event: PointerEvent) => void;
  onHoverIn?: (event: PointerEvent) => void;
  onHoverOut?: (event: PointerEvent) => void;
  /** Not pressable, nor focusable; assistive technology is told it is disabled. */
  disabled?: boolean;
  style?: StyleProp | ((state: PressableState) => StyleProp);
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
