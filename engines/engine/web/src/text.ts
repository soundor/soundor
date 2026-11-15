// Text measured with the browser's fonts, for the engine's line breaking
// (BrowserTextEngine in wasm/Exports.cpp asks, and remembers the answers).
// A canvas measures as the DOM draws: the same font, the same shaping.

import { cssFont } from './style.ts';

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class TextMeasurer {
  #context: Context;
  #font = '';

  constructor() {
    const context =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(1, 1).getContext('2d')
        : typeof document === 'object'
          ? document.createElement('canvas').getContext('2d')
          : null;
    if (!context)
      throw new Error(
        "text measurement needs a canvas: use textMeasurement: 'approximate' where there is none",
      );
    // Kerned, as the DOM draws it (dom.ts says so too): 'auto' would let
    // the canvas skip kerning that an element applies, a pixel's difference
    // in a line of 20px text.
    context.fontKerning = 'normal';
    this.#context = context;
  }

  /** The width of `text` on one line. */
  measure(
    family: string,
    size: number,
    weight: number,
    italic: boolean,
    text: string,
  ): number {
    this.#use(family, size, weight, italic);
    return this.#context.measureText(text).width;
  }

  /** The font's ascent and descent. */
  metrics(
    family: string,
    size: number,
    weight: number,
    italic: boolean,
  ): [number, number] {
    this.#use(family, size, weight, italic);
    const metrics = this.#context.measureText(' ');
    return [metrics.fontBoundingBoxAscent, metrics.fontBoundingBoxDescent];
  }

  #use(family: string, size: number, weight: number, italic: boolean): void {
    const font = cssFont(family, size, weight, italic);
    // Setting it parses it: only when it changes.
    if (font === this.#font) return;
    this.#context.font = font;
    this.#font = font;
  }
}
