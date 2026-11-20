/**
 * Soundor styles as CSS: how a node looks. Where it is, and how large, is the
 * engine's: its C++ core reads every style (and refuses an invalid one) and
 * lays the tree out with Yoga, as in the native runtime; every node's element is
 * placed absolutely where the engine says (`UiNode`), and nothing here
 * decides a size.
 */

import { fontFamilyCss, UI_FONT } from '../text.ts';
import { transformCss } from './animation.ts';
import type { NodeType, Style } from './types.ts';

/** The class every node's element has, and one per node type. */
export const NODE_CLASS = 'sd-node';

/**
 * Defaults that make text like the native runtime's text engine (14px, black,
 * the platform UI font, lines 1.2× the font size, on the lines it wrapped).
 */
export const STYLESHEET = `
.sd-node {
  box-sizing: border-box; display: block; position: absolute;
  left: 0; top: 0; margin: 0; padding: 0;
  border: 0 solid #000; outline: none; pointer-events: auto;
  /* The view shows its own cursor (UiView.cursor()), on the surface. */
  cursor: inherit;
  -webkit-tap-highlight-color: transparent;
  /* Every node stacks its own children, as in the native runtime: zIndex
     orders siblings and never reaches past their parent. */
  z-index: 0;
}
.sd-text, .sd-input {
  color: #000; font-family: ${UI_FONT};
  font-size: 14px; font-weight: 400; font-style: normal; letter-spacing: 0;
  text-align: left; line-height: 16.8px;
}
.sd-text { white-space: pre; }
/* Moved by what puts its baselines where the engine does (TextMeasurer). */
.sd-text-lines { position: relative; display: block; }
.sd-image { object-fit: cover; object-position: center; }
/* A view that scrolls (overflow-x/-y from its style). The browser's scrollbar
   takes room and looks its own: it draws the native runtime's indicators
   instead (UiNode). A wheel no scroll view can use goes on to the page, as
   natively to the host: no overscroll-behavior. */
.sd-scroll { scrollbar-width: none; }
.sd-scroll::-webkit-scrollbar { display: none; }
/* What a scroll view scrolls: as far as the engine's contentSize() goes. */
.sd-scroll-extent {
  position: absolute; left: 0; top: 0; width: 0; height: 0;
  visibility: hidden; pointer-events: none;
}
.sd-scroll-indicator {
  position: absolute; left: 0; top: 0; display: none;
  border-radius: 1.5px; background: rgba(128, 128, 128, 0.376);
  pointer-events: none; z-index: 2147483647;
}
/* Near a mouse: big enough to take hold of, over what takes the press. */
.sd-scroll-indicator-grown { border-radius: 4px; background: rgba(128, 128, 128, 0.6); }
.sd-scroll-indicator-pressed { background: rgba(128, 128, 128, 0.9); }
.sd-scroll-track {
  position: absolute; left: 0; top: 0; display: none;
  background: rgba(128, 128, 128, 0.12);
  cursor: default; user-select: none; z-index: 2147483647;
}
/* After touch, as mobile browsers show theirs: only while it scrolls. */
.sd-scroll-indicator-touch { opacity: 0; transition: opacity 300ms; }
.sd-scroll-indicator-showing { opacity: 1; transition: none; }
.sd-input { background: transparent; appearance: none; text-overflow: clip; }
.sd-surface {
  position: absolute; left: 0; top: 0; width: 100%; height: 100%;
  isolation: isolate; outline: none; cursor: default;
}
/* The two roots: the content, and over all of it the overlay layer, which
   lets the pointer through where nothing in it takes it. */
.sd-root {
  position: absolute; left: 0; top: 0; width: 100%; height: 100%;
  z-index: 0 !important;
}
.sd-overlay { z-index: 1 !important; pointer-events: none !important; }
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
export function fontWeight(value: number | string): number {
  if (value === 'normal') return 400;
  if (value === 'bold') return 700;
  return Number(value);
}

type Overflow = NonNullable<Style['overflow']>;

/**
 * Each axis's overflow: `overflowX`/`overflowY` over `overflow`, as the
 * engine's `Style`. A box clips both axes or neither (see `clips`).
 */
export function overflowOf(style: Readonly<Style>): {
  x: Overflow;
  y: Overflow;
  /** Either axis is not 'visible': what is inside is cut to the padding box. */
  clips: boolean;
  /** Either axis scrolls (on a view). */
  scrolls: boolean;
} {
  const x = style.overflowX ?? style.overflow ?? 'visible';
  const y = style.overflowY ?? style.overflow ?? 'visible';
  return {
    x,
    y,
    clips: x !== 'visible' || y !== 'visible',
    scrolls: x === 'scroll' || y === 'scroll',
  };
}

const CSS_PIXELS = /^-?(\d+\.?\d*|\.\d+)px$/;

/**
 * A style as plugin code gives it, for the engine to read and CSS to draw:
 * without its null or undefined entries, with CSS pixel lengths ('120px') as
 * the numbers Soundor's lengths are, as natively.
 */
export function presentStyle(value: unknown): Style {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object') {
    throw new TypeError(`style must be an object, got ${typeof value}`);
  }
  const style: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined) continue;
    style[key] =
      typeof entry === 'string' && CSS_PIXELS.test(entry)
        ? Number.parseFloat(entry)
        : entry;
  }
  return style as Style;
}

/** `boxShadow` as CSS's `box-shadow`; undefined for none. */
export function boxShadowCss(
  shadows: NonNullable<Style['boxShadow']>,
): string | undefined {
  if (shadows.length === 0) return undefined;
  return shadows
    .map((shadow) => {
      const parts = [
        px(shadow.offsetX ?? 0),
        px(shadow.offsetY ?? 0),
        px(shadow.blur ?? 0),
        px(shadow.spread ?? 0),
        shadow.color ?? 'black',
      ];
      if (shadow.inset === true) parts.unshift('inset');
      return parts.join(' ');
    })
    .join(', ');
}

// ── CSS ──────────────────────────────────────────────────────────────────────

/** The inline CSS of a node of `type` with `style` (one the engine accepted). */
export function cssFor(style: Style, type: NodeType): Css {
  const css: Css = {};
  const set = (property: string, value: string | undefined): void => {
    if (value !== undefined) css[property] = value;
  };

  if (style.display === 'none') css['display'] = 'none';
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

  // A view's axis that scrolls is the browser's to scroll ('auto': it hides
  // its own scrollbar, see .sd-scroll); everything else that clips, clips.
  const overflow = overflowOf(style);
  if (overflow.clips) {
    const axis = (value: Overflow): string =>
      value === 'scroll' && type === 'view' ? 'auto' : 'hidden';
    css['overflow-x'] = axis(overflow.x);
    css['overflow-y'] = axis(overflow.y);
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
  // An outline takes no room, as natively; none unless it has a width.
  if (style.outlineWidth !== undefined && style.outlineWidth > 0) {
    css['outline-style'] = 'solid';
    css['outline-width'] = px(style.outlineWidth);
    css['outline-color'] = style.outlineColor ?? 'black';
    if (style.outlineOffset !== undefined)
      css['outline-offset'] = px(style.outlineOffset);
  }
  if (style.boxShadow !== undefined)
    set('box-shadow', boxShadowCss(style.boxShadow));
  if (style.transform !== undefined)
    css['transform'] = transformCss(style.transform);
  set('will-change', style.willChange);
  if (style.zIndex !== undefined) css['z-index'] = String(style.zIndex);
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
  // '' is the platform's UI font, as natively: the default.
  if (style.fontFamily !== undefined && style.fontFamily !== '')
    css['font-family'] = fontFamilyCss(style.fontFamily);
  // A size that is not positive is ignored, as in the native runtime.
  const fontSize =
    style.fontSize !== undefined && style.fontSize > 0 ? style.fontSize : 14;
  if (fontSize !== 14) css['font-size'] = px(fontSize);
  if (style.fontWeight !== undefined)
    css['font-weight'] = String(fontWeight(style.fontWeight));
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
  // At most that many lines, cut (not ellipsized), as in the native runtime.
  if (type === 'text' && Math.trunc(style.numberOfLines ?? 0) > 0)
    css['overflow'] = 'hidden';
}

/** Serializes CSS declarations for `element.style.cssText`. */
export function cssText(css: Css): string {
  let text = '';
  for (const property in css) text += `${property}:${css[property]};`;
  return text;
}
