/**
 * Soundor styles as CSS. Soundor lays out with Yoga, as React Native does,
 * which differs from CSS's defaults: every box is a flex column that does
 * not shrink, sizes count borders and padding, and text takes no style from
 * its ancestors. The stylesheet below sets those defaults on every node, so
 * a node's inline CSS only carries what its own style says.
 */

import type { NodeType, Style } from './types';

/** The class every node's element has, and one per node type. */
export const NODE_CLASS = 'sd-node';

/**
 * Defaults that make the DOM lay out like Yoga, and text like the JUCE
 * runtime's text engine (14px, black, the platform UI font, lines 1.2× the
 * font size, wrapped at spaces).
 */
export const STYLESHEET = `
.sd-node {
  box-sizing: border-box; display: flex; flex-direction: column;
  flex-shrink: 0; align-items: stretch; align-content: flex-start;
  position: relative; min-width: 0; min-height: 0; margin: 0; padding: 0;
  border: 0 solid #000; outline: none; pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
}
.sd-text, .sd-input {
  color: #000; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 14px; font-weight: 400; font-style: normal; letter-spacing: 0;
  text-align: left; line-height: 16.8px;
}
.sd-text { display: block; white-space: pre-wrap; overflow-wrap: normal; }
.sd-image { display: block; object-fit: cover; object-position: center; }
.sd-scroll { overflow: auto; scrollbar-width: thin; overscroll-behavior: contain; }
.sd-input { background: transparent; appearance: none; text-overflow: clip; }
.sd-root { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.sd-hidden { display: none !important; }
.sd-pe-none, .sd-pe-none * { pointer-events: none !important; }
.sd-pe-box-none { pointer-events: none !important; }
.sd-pe-box-only * { pointer-events: none !important; }
`;

const POINTER_CLASSES = {
  auto: '',
  none: 'sd-pe-none',
  'box-none': 'sd-pe-box-none',
  'box-only': 'sd-pe-box-only',
} as const;

/** The pointer-events class for a style, or ''. */
export function pointerClass(style: Style): string {
  return POINTER_CLASSES[style.pointerEvents ?? 'auto'] ?? '';
}

type Css = Record<string, string>;

const px = (value: number): string => `${value}px`;

/** A Soundor length: logical pixels, a percentage, or 'auto'. */
function length(value: number | string): string {
  return typeof value === 'number' ? px(value) : value;
}

/** The first defined value, most specific first (React Native's rule). */
function pick<T>(...values: (T | undefined)[]): T | undefined {
  for (const value of values) if (value !== undefined) return value;
  return undefined;
}

const RESIZE: Readonly<Record<string, string>> = {
  cover: 'cover',
  contain: 'contain',
  stretch: 'fill',
  // Centered at its own size, scaled down to fit.
  center: 'scale-down',
};

/** A font weight from 1 to 1000; 'normal' is 400 and 'bold' 700. */
function weight(value: number | string): number {
  if (value === 'normal') return 400;
  if (value === 'bold') return 700;
  return Number(value);
}

// ── Validation ───────────────────────────────────────────────────────────────

const CHOICES: Readonly<Record<string, readonly string[]>> = {
  display: ['flex', 'none'],
  position: ['relative', 'absolute', 'static'],
  flexDirection: ['column', 'column-reverse', 'row', 'row-reverse'],
  flexWrap: ['nowrap', 'wrap', 'wrap-reverse'],
  justifyContent: [
    'flex-start',
    'center',
    'flex-end',
    'space-between',
    'space-around',
    'space-evenly',
  ],
  alignItems: ALIGNS(),
  alignSelf: ALIGNS(),
  alignContent: ALIGNS(),
  overflow: ['visible', 'hidden', 'scroll'],
  boxSizing: ['border-box', 'content-box'],
  pointerEvents: ['auto', 'none', 'box-none', 'box-only'],
  resizeMode: ['cover', 'contain', 'stretch', 'center'],
  fontStyle: ['normal', 'italic'],
  textAlign: ['auto', 'left', 'center', 'right'],
};

function ALIGNS(): readonly string[] {
  return [
    'auto',
    'flex-start',
    'center',
    'flex-end',
    'stretch',
    'baseline',
    'space-between',
    'space-around',
    'space-evenly',
  ];
}

const NUMBERS = [
  'flex',
  'flexGrow',
  'flexShrink',
  'aspectRatio',
  'borderWidth',
  'borderHorizontalWidth',
  'borderVerticalWidth',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'gap',
  'rowGap',
  'columnGap',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'opacity',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'numberOfLines',
];

const AUTO_LENGTHS = [
  'flexBasis',
  'width',
  'height',
  'margin',
  'marginHorizontal',
  'marginVertical',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
];

const LENGTHS = [
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'padding',
  'paddingHorizontal',
  'paddingVertical',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
];

const COLORS = ['color', 'backgroundColor', 'borderColor'];

/**
 * Checks a style as the JUCE runtime does and returns it without null or
 * undefined entries. Unknown keys are ignored; a known key with an invalid
 * value is a TypeError naming it.
 */
export function readStyle(value: unknown): Style {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object') {
    throw new TypeError(`style must be an object, got ${typeof value}`);
  }
  const style: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && entry !== undefined) style[key] = entry;
  }
  const fail = (key: string, expected: string): never => {
    const got = style[key];
    throw new TypeError(
      `style.${key}: expected ${expected}, got ${typeof got === 'string' ? `'${got}'` : String(got)}`,
    );
  };
  for (const [key, names] of Object.entries(CHOICES)) {
    if (key in style && !names.includes(style[key] as string)) {
      fail(key, `one of ${names.map((name) => `'${name}'`).join(', ')}`);
    }
  }
  for (const key of NUMBERS) {
    if (key in style && !Number.isFinite(style[key]))
      fail(key, 'a finite number');
  }
  for (const key of AUTO_LENGTHS) {
    if (key in style && !isLength(style[key], true))
      fail(key, "a number, a percentage or 'auto'");
  }
  for (const key of LENGTHS) {
    if (key in style && !isLength(style[key], false))
      fail(key, 'a number or a percentage');
  }
  for (const key of COLORS) {
    if (key in style && !isColor(style[key])) fail(key, 'a CSS color');
  }
  if ('fontFamily' in style && typeof style['fontFamily'] !== 'string') {
    fail('fontFamily', 'a string');
  }
  if ('fontWeight' in style) {
    const raw = style['fontWeight'];
    const value =
      typeof raw === 'number' || typeof raw === 'string'
        ? weight(raw)
        : Number.NaN;
    if (!(value >= 1 && value <= 1000)) {
      fail('fontWeight', "a weight from 1 to 1000, 'normal' or 'bold'");
    }
  }
  return style as Style;
}

function isLength(value: unknown, allowAuto: boolean): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  if (allowAuto && value === 'auto') return true;
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?%$/i.test(value);
}

function isColor(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return typeof CSS === 'undefined' || CSS.supports('color', value);
}

// ── CSS ──────────────────────────────────────────────────────────────────────

/** The inline CSS of a node of `type` with `style` (read by readStyle). */
export function cssFor(style: Style, type: NodeType): Css {
  const css: Css = {};
  const set = (property: string, value: string | undefined): void => {
    if (value !== undefined) css[property] = value;
  };

  if (style.display === 'none') css['display'] = 'none';
  set('position', style.position);
  set('flex-direction', style.flexDirection);
  set('flex-wrap', style.flexWrap);
  set('justify-content', style.justifyContent);
  set(
    'align-items',
    style.alignItems === 'auto' ? 'stretch' : style.alignItems,
  );
  set('align-self', style.alignSelf);
  set('align-content', style.alignContent);

  // `flex` as in React Native: n > 0 grows by n, shrinks, from zero; a
  // negative n only shrinks. The longhands win over it.
  if (style.flex !== undefined && style.flex > 0) {
    css['flex-grow'] = String(style.flex);
    css['flex-shrink'] = '1';
    css['flex-basis'] = '0px';
  } else if (style.flex !== undefined && style.flex < 0) {
    css['flex-shrink'] = '1';
  }
  if (style.flexGrow !== undefined) css['flex-grow'] = String(style.flexGrow);
  if (style.flexShrink !== undefined)
    css['flex-shrink'] = String(style.flexShrink);
  if (style.flexBasis !== undefined)
    css['flex-basis'] = length(style.flexBasis);

  for (const [property, key] of [
    ['width', 'width'],
    ['height', 'height'],
    ['min-width', 'minWidth'],
    ['min-height', 'minHeight'],
    ['max-width', 'maxWidth'],
    ['max-height', 'maxHeight'],
  ] as const) {
    const value = style[key];
    if (value !== undefined) css[property] = length(value);
  }
  if (style.aspectRatio !== undefined)
    css['aspect-ratio'] = String(style.aspectRatio);
  set('box-sizing', style.boxSizing);

  edges(
    css,
    'margin',
    style.margin,
    style.marginHorizontal,
    style.marginVertical,
    {
      top: style.marginTop,
      right: style.marginRight,
      bottom: style.marginBottom,
      left: style.marginLeft,
    },
  );
  edges(
    css,
    'padding',
    style.padding,
    style.paddingHorizontal,
    style.paddingVertical,
    {
      top: style.paddingTop,
      right: style.paddingRight,
      bottom: style.paddingBottom,
      left: style.paddingLeft,
    },
  );
  const borders = {
    top: pick(
      style.borderTopWidth,
      style.borderVerticalWidth,
      style.borderWidth,
    ),
    right: pick(
      style.borderRightWidth,
      style.borderHorizontalWidth,
      style.borderWidth,
    ),
    bottom: pick(
      style.borderBottomWidth,
      style.borderVerticalWidth,
      style.borderWidth,
    ),
    left: pick(
      style.borderLeftWidth,
      style.borderHorizontalWidth,
      style.borderWidth,
    ),
  };
  for (const [edge, value] of Object.entries(borders)) {
    if (value !== undefined) css[`border-${edge}-width`] = px(value);
  }
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
    const value = pick(style[edge], style.inset);
    if (value !== undefined) css[edge] = length(value);
  }
  const rowGap = pick(style.rowGap, style.gap);
  const columnGap = pick(style.columnGap, style.gap);
  if (rowGap !== undefined) css['row-gap'] = px(rowGap);
  if (columnGap !== undefined) css['column-gap'] = px(columnGap);

  // Scroll views always scroll; elsewhere 'scroll' clips, as in Yoga.
  if (style.overflow !== undefined && type !== 'scroll') {
    css['overflow'] = style.overflow === 'visible' ? 'visible' : 'hidden';
  }

  set('background-color', style.backgroundColor);
  set('border-color', style.borderColor);
  if (style.borderRadius !== undefined)
    css['border-radius'] = px(style.borderRadius);
  for (const [property, key] of [
    ['border-top-left-radius', 'borderTopLeftRadius'],
    ['border-top-right-radius', 'borderTopRightRadius'],
    ['border-bottom-right-radius', 'borderBottomRightRadius'],
    ['border-bottom-left-radius', 'borderBottomLeftRadius'],
  ] as const) {
    const value = style[key];
    if (value !== undefined) css[property] = px(value);
  }
  if (style.opacity !== undefined) {
    css['opacity'] = String(Math.min(1, Math.max(0, style.opacity)));
  }

  if (type === 'text' || type === 'input') text(css, style, type);
  if (type === 'image' && style.resizeMode !== undefined) {
    css['object-fit'] = RESIZE[style.resizeMode] ?? 'cover';
  }
  return css;
}

/** Text properties; only text and input nodes are set in text. */
function text(css: Css, style: Style, type: NodeType): void {
  if (style.fontFamily !== undefined)
    css['font-family'] = `${style.fontFamily}, system-ui, sans-serif`;
  // A size that is not positive is ignored, as in the JUCE runtime.
  const fontSize =
    style.fontSize !== undefined && style.fontSize > 0 ? style.fontSize : 14;
  if (fontSize !== 14) css['font-size'] = px(fontSize);
  if (style.fontWeight !== undefined)
    css['font-weight'] = String(weight(style.fontWeight));
  if (style.fontStyle !== undefined) css['font-style'] = style.fontStyle;
  // Lines are lineHeight tall, or 1.2 × the font size ("normal").
  const lineHeight =
    style.lineHeight !== undefined && style.lineHeight > 0
      ? style.lineHeight
      : fontSize * 1.2;
  css['line-height'] = px(lineHeight);
  if (style.letterSpacing !== undefined)
    css['letter-spacing'] = px(style.letterSpacing);
  if (style.textAlign !== undefined)
    css['text-align'] = style.textAlign === 'auto' ? 'left' : style.textAlign;
  if (style.color !== undefined) css['color'] = style.color;
  const lines = Math.trunc(style.numberOfLines ?? 0);
  if (type === 'text' && lines > 0) {
    // At most that many lines, cut (not ellipsized), as in the JUCE runtime.
    css['max-height'] = px(lines * lineHeight);
    css['overflow'] = 'hidden';
  }
}

/** Margins or paddings: one edge, then horizontal/vertical, then all. */
function edges(
  css: Css,
  property: 'margin' | 'padding',
  all: number | string | undefined,
  horizontal: number | string | undefined,
  vertical: number | string | undefined,
  each: Record<
    'top' | 'right' | 'bottom' | 'left',
    number | string | undefined
  >,
): void {
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
    const axis = edge === 'top' || edge === 'bottom' ? vertical : horizontal;
    const value = pick(each[edge], axis, all);
    if (value !== undefined) css[`${property}-${edge}`] = length(value);
  }
}

/** Serializes CSS declarations for `element.style.cssText`. */
export function cssText(css: Css): string {
  let text = '';
  for (const property in css) text += `${property}:${css[property]};`;
  return text;
}
