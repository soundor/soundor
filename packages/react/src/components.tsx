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

import { ScopeContext } from './focus';
import { HostTypes, SCOPE_PROP } from './host';
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

export interface ViewProps extends EventProps {
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

export interface TextProps extends EventProps {
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

export interface ImageProps extends EventProps {
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

export interface TextInputProps extends EventProps {
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
  /** A press; not after a long press, when onLongPress is given. */
  onPress?: (event: PointerEvent | KeyboardEvent) => void;
  /** Held down `delayLongPress` ms without moving away. */
  onLongPress?: (event: PointerEvent) => void;
  /** Milliseconds before a press is a long press: 500 by default. */
  delayLongPress?: number;
  onPressIn?: (event: PointerEvent) => void;
  onPressOut?: (event: PointerEvent) => void;
  onHoverIn?: (event: PointerEvent) => void;
  onHoverOut?: (event: PointerEvent) => void;
  disabled?: boolean;
  style?: StyleProp | ((state: PressableState) => StyleProp);
  children?: ReactNode | ((state: PressableState) => ReactNode);
}

/**
 * A view that responds to presses: a click, or Enter/Space while focused,
 * and long presses. `style` and `children` may depend on whether it is
 * pressed, hovered or focused.
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
    const undo = pressable(node, {
      onPress: (event) => handlers.current.onPress?.(event),
      ...(longPresses && {
        onLongPress: (event: PointerEvent) =>
          handlers.current.onLongPress?.(event),
        delayLongPress,
      }),
      onPressIn: (event) => handlers.current.onPressIn?.(event),
      onPressOut: (event) => handlers.current.onPressOut?.(event),
      onHoverIn: (event) => handlers.current.onHoverIn?.(event),
      onHoverOut: (event) => handlers.current.onHoverOut?.(event),
      onStateChange: setState,
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
      focusable: !disabled,
      style: typeof style === 'function' ? style(state) : style,
    },
    typeof children === 'function' ? children(state) : children,
  );
}

export type { Style };
