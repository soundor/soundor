/**
 * The shapes `soundor:ui` declares (packages/core/runtime/ui.d.ts), for the
 * browser code. That declaration cannot be included here: it comes with
 * Soundor's own Web globals, which clash with the DOM's. A type test keeps
 * the two in step.
 */

/** Logical pixels, a percentage of the parent, or (where allowed) 'auto'. */
export type Dimension = number | `${number}%` | 'auto';
export type Percentage = number | `${number}%`;
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
  /** Images: how the image fills the box. */
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
}

/** A CSS color string. */
export type Color = string;

export interface LayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type NodeType = 'view' | 'text' | 'image' | 'scroll' | 'input';
