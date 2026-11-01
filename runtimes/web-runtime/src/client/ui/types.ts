import type { UiNode } from './node';

/**
 * The shapes `soundor:ui` declares (packages/environment/ui.d.ts), for the
 * browser code. That declaration cannot be included here: it comes with
 * Soundor's own Web globals, which clash with the DOM's. A type test keeps
 * the two in step.
 */

/** Logical pixels (a number, or CSS pixels: '120px'), a percentage of the parent, or (where allowed) 'auto'. */
export type Dimension = number | `${number}px` | `${number}%` | 'auto';
export type Percentage = number | `${number}px` | `${number}%`;
export type TransformOperation =
  | { translateX: number }
  | { translateY: number }
  | { scale: number }
  | { scaleX: number }
  | { scaleY: number }
  | { rotate: number | `${number}deg` | `${number}rad` };
export type AnimationEasing =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out';
export interface AnimationKeyframe {
  opacity?: number;
  transform?: readonly TransformOperation[];
  backgroundColor?: string;
  borderColor?: string;
  offset?: number;
  easing?: AnimationEasing;
}
export interface AnimationOptions {
  type?: 'timing' | 'spring';
  duration?: number;
  delay?: number;
  easing?: AnimationEasing;
  fill?: 'none' | 'backwards' | 'forwards' | 'both';
  iterations?: number;
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  stiffness?: number;
  damping?: number;
  mass?: number;
  initialVelocity?: number;
  restDisplacement?: number;
  restVelocity?: number;
}
export type AnimationPlaybackOptions = Pick<
  AnimationOptions,
  'delay' | 'easing' | 'fill' | 'iterations' | 'direction'
>;
export interface AnimationEffect {
  kind?: 'effect';
  target?: UiNode;
  keyframes: readonly AnimationKeyframe[];
  options?: AnimationOptions;
}
export interface AnimationComposition {
  kind: 'sequence' | 'parallel' | 'stagger';
  children: readonly AnimationDescription[];
  options?: AnimationPlaybackOptions;
  stagger?: number;
}
export interface AnimationDelay {
  kind: 'delay';
  duration: number;
}
export type AnimationDescription =
  | AnimationEffect
  | AnimationComposition
  | AnimationDelay;
export interface UiAnimation {
  readonly finished: Promise<void>;
  readonly playState: 'idle' | 'running' | 'paused' | 'finished';
  currentTime: number;
  play(): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  finish(): void;
}

export type FlexAlign =
  | 'auto'
  | 'flex-start'
  | 'center'
  | 'flex-end'
  | 'stretch'
  | 'baseline'
  | 'space-between'
  | 'space-around'
  | 'space-evenly';

/**
 * Flexbox layout as in React Native (column by default, no shrinking unless
 * asked) and text properties.
 */
export interface Style {
  display?: 'flex' | 'none';
  position?: 'relative' | 'absolute' | 'static';
  flexDirection?: 'column' | 'column-reverse' | 'row' | 'row-reverse';
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  justifyContent?:
    | 'flex-start'
    | 'center'
    | 'flex-end'
    | 'space-between'
    | 'space-around'
    | 'space-evenly';
  alignItems?: FlexAlign;
  alignSelf?: FlexAlign;
  alignContent?: FlexAlign;
  /** `flex: n` (n > 0) grows by n, shrinks, and starts from zero. */
  flex?: number;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: Dimension;

  width?: Dimension;
  height?: Dimension;
  minWidth?: Percentage;
  minHeight?: Percentage;
  maxWidth?: Percentage;
  maxHeight?: Percentage;
  aspectRatio?: number;
  boxSizing?: 'border-box' | 'content-box';

  margin?: Dimension;
  marginHorizontal?: Dimension;
  marginVertical?: Dimension;
  marginTop?: Dimension;
  marginRight?: Dimension;
  marginBottom?: Dimension;
  marginLeft?: Dimension;
  padding?: Percentage;
  paddingHorizontal?: Percentage;
  paddingVertical?: Percentage;
  paddingTop?: Percentage;
  paddingRight?: Percentage;
  paddingBottom?: Percentage;
  paddingLeft?: Percentage;
  borderWidth?: number;
  borderHorizontalWidth?: number;
  borderVerticalWidth?: number;
  borderTopWidth?: number;
  borderRightWidth?: number;
  borderBottomWidth?: number;
  borderLeftWidth?: number;
  inset?: Dimension;
  top?: Dimension;
  right?: Dimension;
  bottom?: Dimension;
  left?: Dimension;
  gap?: number;
  rowGap?: number;
  columnGap?: number;

  overflow?: 'visible' | 'hidden' | 'scroll';
  /** 'box-none': not the node, but its children; 'box-only': the reverse. */
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
  cursor?: Cursor;
  /** Stacks the node among its siblings (an integer, 0 by default). */
  zIndex?: number;

  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'auto' | 'left' | 'center' | 'right';
  /** Text nodes: at most this many lines (0: no limit). */
  numberOfLines?: number;
  color?: Color;

  /** Any CSS color: '#rgb[a]', '#rrggbb[aa]', rgb(), hsl(), a name, 'transparent'. */
  backgroundColor?: Color;
  borderColor?: Color;
  borderRadius?: number;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomRightRadius?: number;
  borderBottomLeftRadius?: number;
  /** 0 to 1, for the node and everything in it. */
  opacity?: number;
  transform?: readonly TransformOperation[];
  /** Images: how the image fills the box. */
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
}

/** A CSS color string. */
export type Color = string;
/** The pointer's shape over a node: 'auto' takes the parent's. */
export type Cursor =
  | 'auto'
  | 'default'
  | 'none'
  | 'pointer'
  | 'text'
  | 'crosshair'
  | 'move'
  | 'ew-resize'
  | 'ns-resize'
  | 'nesw-resize'
  | 'nwse-resize';

export interface LayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type NodeType =
  | 'view'
  | 'text'
  | 'image'
  | 'scroll'
  | 'input'
  | 'canvas'
  | 'svg';

export type AccessibilityRole =
  | 'none'
  | 'text'
  | 'image'
  | 'button'
  | 'link'
  | 'adjustable'
  | 'checkbox'
  | 'switch'
  | 'togglebutton'
  | 'radio'
  | 'radiogroup'
  | 'progressbar'
  | 'search'
  | 'combobox'
  | 'menu'
  | 'menubar'
  | 'menuitem'
  | 'scrollbar'
  | 'spinbutton'
  | 'tab'
  | 'tablist'
  | 'header'
  | 'summary'
  | 'keyboardkey'
  | 'timer'
  | 'toolbar'
  | 'alert'
  | 'dialog';

export interface AccessibilityState {
  disabled?: boolean;
  selected?: boolean;
  /** 'mixed': partly checked. */
  checked?: boolean | 'mixed';
  busy?: boolean;
  expanded?: boolean;
}

/** A range's value (fractional values welcome), and how to read it. */
export interface AccessibilityValue {
  min?: number;
  max?: number;
  now?: number;
  /** Read in place of the number: '-3.5 dB'. */
  text?: string;
}

export type AccessibilityActionName =
  | 'activate'
  | 'increment'
  | 'decrement'
  | 'longpress'
  | 'expand'
  | 'collapse'
  | 'escape'
  | 'focus'
  | 'blur'
  | 'setValue'
  | (string & {});

export interface AccessibilityAction {
  name: AccessibilityActionName;
  /** How a custom action is presented. */
  label?: string;
}

/** What a node is to assistive technology. */
export interface Accessibility {
  accessible?: boolean;
  role?: AccessibilityRole;
  label?: string;
  hint?: string;
  state?: AccessibilityState;
  value?: AccessibilityValue;
  actions?: readonly AccessibilityAction[];
  modal?: boolean;
}

/** The view's size in logical pixels, and device pixels per logical pixel. */
export interface ViewSize {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

/** Presentation in SVG user units, independent of Soundor's layout Style. */
export interface SvgPresentation {
  /** Fill paint; defaults to black. */
  fill?: string;
  /** Stroke paint; defaults to none. */
  stroke?: string;
  /** Inherited color used by currentColor; defaults to black. */
  color?: string;
  /** Stroke width in SVG user units; defaults to 1. Zero draws no stroke. */
  strokeWidth?: number;
  /** Fill winding rule; defaults to nonzero. */
  fillRule?: 'nonzero' | 'evenodd';
  /** Stroke endpoint shape; defaults to butt. */
  strokeLinecap?: 'butt' | 'round' | 'square';
  /** Stroke join shape; defaults to miter. */
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  /** Miter limit, at least 1; defaults to 4. */
  strokeMiterlimit?: number;
  /** Nonnegative dash lengths; an odd list repeats, all-zero means solid. */
  strokeDasharray?: readonly number[];
  /** Signed dash offset in SVG user units. */
  strokeDashoffset?: number;
  /** Isolated opacity of this shape/group, not inherited; defaults to 1. */
  opacity?: number;
  /** Inherited fill opacity; defaults to 1. */
  fillOpacity?: number;
  /** Inherited stroke opacity; defaults to 1. */
  strokeOpacity?: number;
  /** Local affine matrix [a,b,c,d,e,f]. */
  transform?: readonly [number, number, number, number, number, number];
}
export type SvgAlignment = `x${'Min' | 'Mid' | 'Max'}Y${'Min' | 'Mid' | 'Max'}`;
export type SvgPreserveAspectRatio =
  | 'none'
  | SvgAlignment
  | `${SvgAlignment} ${'meet' | 'slice'}`;
/** Retained geometry. Only groups contain shapes; none create UI nodes. */
export type SvgShape = { readonly presentation?: SvgPresentation } & (
  | { readonly type: 'g'; readonly children?: readonly SvgShape[] }
  | { readonly type: 'path'; readonly d?: string }
  | {
      readonly type: 'circle';
      readonly cx?: number;
      readonly cy?: number;
      readonly r?: number;
    }
  | {
      readonly type: 'rect';
      readonly x?: number;
      readonly y?: number;
      readonly width?: number;
      readonly height?: number;
      readonly rx?: number;
      readonly ry?: number;
    }
  | {
      readonly type: 'ellipse';
      readonly cx?: number;
      readonly cy?: number;
      readonly rx?: number;
      readonly ry?: number;
    }
  | {
      readonly type: 'line';
      readonly x1?: number;
      readonly y1?: number;
      readonly x2?: number;
      readonly y2?: number;
    }
  | {
      readonly type: 'polyline' | 'polygon';
      readonly points?: readonly number[];
    }
);
/** Atomic scene protocol v1, requiring @soundor/engine 0.6.0 or later. */
export interface SvgScene {
  readonly version: 1;
  /** User-space origin and positive dimensions, independent of Yoga. */
  readonly viewBox?: readonly [number, number, number, number];
  /** ViewBox mapping; defaults to xMidYMid meet. */
  readonly preserveAspectRatio?: SvgPreserveAspectRatio;
  /** Root presentation, inherited by its shapes. */
  readonly presentation?: SvgPresentation;
  readonly children: readonly SvgShape[];
}
