/**
 * Text set as the JUCE runtime sets it (`TextEngine::layout` in the engine):
 * wrapped only at spaces and line breaks, each line its measured width. Only
 * the widths are the browser's. The node's element then shows these very lines,
 * so what is drawn is what was measured.
 */

import { fontFamilyCss, fontWeight, UI_FONT } from './style';
import type { Style } from './types';

export interface TextLines {
  readonly lines: readonly string[];
  /** The widest line. */
  readonly width: number;
  /** Every line's height together. */
  readonly height: number;
}

/** How wide a run of text is. */
export interface TextMeasurer {
  advance(text: string, style: Readonly<Style>): number;
  /** Forgets what it measured: fonts have changed. */
  reset(): void;
}

// In 32-bit floats, as the engine and Yoga count: an edge on a rounding boundary
// must round the same way.
const { fround } = Math;

/** A size that is not positive is ignored, as in the JUCE runtime. */
export function fontSizeOf(style: Readonly<Style>): number {
  return style.fontSize !== undefined && style.fontSize > 0
    ? style.fontSize
    : 14;
}

/** Lines are lineHeight tall, or 1.2 × the font size ("normal"). */
export function lineHeightOf(style: Readonly<Style>): number {
  return style.lineHeight !== undefined && style.lineHeight > 0
    ? style.lineHeight
    : fround(fontSizeOf(style) * fround(1.2));
}

/** The style properties text is measured by. */
const TEXT_PROPERTIES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'numberOfLines',
] as const;

export function sameTextStyle(a: Readonly<Style>, b: Readonly<Style>): boolean {
  return TEXT_PROPERTIES.every((property) => a[property] === b[property]);
}

/** A greedy word wrap: the longest run of whole words that fits. */
export function layoutText(
  measurer: TextMeasurer,
  text: string,
  style: Readonly<Style>,
  maxWidth: number,
): TextLines {
  const lineHeight = lineHeightOf(style);
  const given = Math.trunc(style.numberOfLines ?? 0);
  const limit = given > 0 ? given : Infinity;
  const lines: string[] = [];
  let width = 0;
  const emit = (begin: number, end: number): void => {
    if (lines.length >= limit) return;
    const line = text.slice(begin, end);
    lines.push(line);
    width = Math.max(width, measurer.advance(line, style));
  };
  const fitsAll = maxWidth === Infinity;

  let paragraph = 0;
  for (;;) {
    const newline = text.indexOf('\n', paragraph);
    const paragraphEnd = newline < 0 ? text.length : newline;
    let lineBegin = paragraph;
    let lineEnd = paragraph;
    let position = paragraph;
    while (position < paragraphEnd) {
      const space = text.indexOf(' ', position);
      const wordEnd = space < 0 || space > paragraphEnd ? paragraphEnd : space;
      const fits =
        fitsAll ||
        measurer.advance(text.slice(lineBegin, wordEnd), style) <= maxWidth;
      // A word wider than the line gets a line of its own.
      if (fits || lineEnd === lineBegin) lineEnd = wordEnd;
      else {
        emit(lineBegin, lineEnd);
        lineBegin = position;
        lineEnd = wordEnd;
      }
      position = wordEnd;
      while (position < paragraphEnd && text[position] === ' ') position++;
      // Leading spaces stay with the first word of a line.
      if (lineEnd === lineBegin) lineEnd = position;
    }
    emit(lineBegin, lineEnd);
    if (paragraphEnd === text.length) break;
    paragraph = paragraphEnd + 1;
  }
  return { lines, width, height: fround(lines.length * lineHeight) };
}

/** What a page holds of measured runs, per font, before starting over. */
const MEASURED_RUNS = 20_000;

/**
 * Measures on a canvas: the browser's own shaping and fonts, without touching
 * the page's layout. Where a page has no canvas (tests), every character is
 * 0.55 em wide, as in the engine's approximate text engine.
 */
export function canvasMeasurer(document: Document): TextMeasurer {
  let context: CanvasRenderingContext2D | null | undefined;
  let runs = new Map<string, number>();
  let font = '';

  const approximate = (text: string, style: Readonly<Style>): number =>
    fround(
      [...text].length *
        fround(
          fround(fontSizeOf(style) * fround(0.55)) + (style.letterSpacing ?? 0),
        ),
    );

  return {
    advance(text, style) {
      if (context === undefined) {
        try {
          context = document.createElement('canvas').getContext('2d');
        } catch {
          context = null;
        }
      }
      if (context === null) return approximate(text, style);
      const family =
        style.fontFamily !== undefined && style.fontFamily !== ''
          ? fontFamilyCss(style.fontFamily)
          : UI_FONT;
      const spacing = style.letterSpacing ?? 0;
      const wanted = `${style.fontStyle ?? 'normal'} ${fontWeight(style.fontWeight ?? 400)} ${fontSizeOf(style)}px ${family}`;
      const key = `${wanted}\0${spacing}\0${text}`;
      const known = runs.get(key);
      if (known !== undefined) return known;
      if (wanted !== font) {
        context.font = wanted;
        font = wanted;
      }
      // The canvas's own letterSpacing would change the state for every run,
      // and not all browsers have it. Spacing follows each character.
      const width =
        context.measureText(text).width + [...text].length * spacing;
      if (runs.size >= MEASURED_RUNS) runs = new Map();
      runs.set(key, width);
      return width;
    },
    reset() {
      runs = new Map();
      font = '';
    },
  };
}
