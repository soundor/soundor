// A node's style: what the engine lays out with (read by its C++ core, the
// same rules as soundor:ui natively), and what the DOM then draws with CSS.

/** A length: points, a percentage (`'50%'`), or `'auto'` where allowed. */
export type Length = number | `${number}%` | 'auto';

type Align =
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
 * The style properties the WebAssembly engine supports: soundor:ui's
 * flexbox layout (React Native's names), the box's colors, borders and
 * opacity, and text. `boxShadow` and `transform` are not supported yet;
 * unknown properties are ignored.
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
  alignItems?: Align;
  alignSelf?: Align;
  alignContent?: Align;
  /** React Native's: a positive number grows and shrinks from a basis of 0. */
  flex?: number;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: Length;
  width?: Length;
  height?: Length;
  minWidth?: Exclude<Length, 'auto'>;
  minHeight?: Exclude<Length, 'auto'>;
  maxWidth?: Exclude<Length, 'auto'>;
  maxHeight?: Exclude<Length, 'auto'>;
  aspectRatio?: number;
  boxSizing?: 'border-box' | 'content-box';
  margin?: Length;
  marginVertical?: Length;
  marginHorizontal?: Length;
  marginTop?: Length;
  marginRight?: Length;
  marginBottom?: Length;
  marginLeft?: Length;
  padding?: Exclude<Length, 'auto'>;
  paddingVertical?: Exclude<Length, 'auto'>;
  paddingHorizontal?: Exclude<Length, 'auto'>;
  paddingTop?: Exclude<Length, 'auto'>;
  paddingRight?: Exclude<Length, 'auto'>;
  paddingBottom?: Exclude<Length, 'auto'>;
  paddingLeft?: Exclude<Length, 'auto'>;
  inset?: Length;
  top?: Length;
  right?: Length;
  bottom?: Length;
  left?: Length;
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  borderWidth?: number;
  borderVerticalWidth?: number;
  borderHorizontalWidth?: number;
  borderTopWidth?: number;
  borderRightWidth?: number;
  borderBottomWidth?: number;
  borderLeftWidth?: number;
  /** Clips what is inside when not `'visible'` (`'scroll'` does not scroll yet). */
  overflow?: 'visible' | 'hidden' | 'scroll';
  overflowX?: 'visible' | 'hidden' | 'scroll';
  overflowY?: 'visible' | 'hidden' | 'scroll';
  zIndex?: number;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
  cursor?:
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
  /** A CSS color. */
  backgroundColor?: string;
  /** A CSS color. */
  borderColor?: string;
  borderRadius?: number;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomRightRadius?: number;
  borderBottomLeftRadius?: number;
  outlineWidth?: number;
  outlineOffset?: number;
  /** A CSS color. */
  outlineColor?: string;
  /** 0 (invisible) to 1. */
  opacity?: number;
  /** A CSS color: the text's. */
  color?: string;
  /** Empty or unset: the browser's UI font. */
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  /** In points; unset: 1.2 × fontSize. */
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'auto' | 'left' | 'center' | 'right';
  /** At most this many lines (0: unlimited). */
  numberOfLines?: number;
}

/** The font family of text without one. */
export const defaultFontFamily = 'system-ui, sans-serif';

/**
 * The CSS font of text in the engine's font: the same string measures it
 * (a canvas's `font`) and draws it (an element's).
 */
export function cssFont(
  family: string,
  size: number,
  weight: number,
  italic: boolean,
): string {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${cssFamily(family)}`;
}

// As CSS has it: a name, quoted where it needs to be, a generic family
// (`serif`, `monospace`), or a list of them.
function cssFamily(family: string): string {
  return family === '' ? defaultFontFamily : family;
}

const cursors: Record<string, string> = {
  auto: 'auto',
  default: 'default',
  none: 'none',
  pointer: 'pointer',
  text: 'text',
  crosshair: 'crosshair',
  move: 'move',
  'ew-resize': 'ew-resize',
  'ns-resize': 'ns-resize',
  'nesw-resize': 'nesw-resize',
  'nwse-resize': 'nwse-resize',
};

/**
 * What CSS draws of a style: colors, the border's color and corners, the
 * outline, opacity, clipping and stacking. Never sizes or positions: those
 * are the engine's layout's (applied from its frames).
 */
export function drawStyle(element: HTMLElement, style: Style): void {
  const css = element.style;
  css.display = style.display === 'none' ? 'none' : '';
  css.backgroundColor = style.backgroundColor ?? '';
  css.borderColor = style.borderColor ?? 'black';
  const radius = style.borderRadius ?? 0;
  css.borderRadius = `${style.borderTopLeftRadius ?? radius}px ${style.borderTopRightRadius ?? radius}px ${style.borderBottomRightRadius ?? radius}px ${style.borderBottomLeftRadius ?? radius}px`;
  const outline = style.outlineWidth ?? 0;
  css.outline =
    outline > 0 ? `${outline}px solid ${style.outlineColor ?? 'black'}` : '';
  css.outlineOffset = outline > 0 ? `${style.outlineOffset ?? 0}px` : '';
  css.opacity =
    style.opacity === undefined
      ? ''
      : String(Math.min(1, Math.max(0, style.opacity)));
  const overflowX = style.overflowX ?? style.overflow ?? 'visible';
  const overflowY = style.overflowY ?? style.overflow ?? 'visible';
  // Both axes clip or neither, as natively.
  css.overflow =
    overflowX !== 'visible' || overflowY !== 'visible' ? 'hidden' : '';
  css.zIndex = style.zIndex ? String(style.zIndex) : '';
  css.pointerEvents = style.pointerEvents === 'none' ? 'none' : '';
  css.cursor = cursors[style.cursor ?? 'auto'] ?? '';
  css.color = style.color ?? 'black';
  css.letterSpacing = style.letterSpacing ? `${style.letterSpacing}px` : '';
}
