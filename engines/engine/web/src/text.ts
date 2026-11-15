// Text measured with the browser's fonts, for the engine's line breaking
// (BrowserTextEngine in wasm/Exports.cpp asks, and remembers the answers).
// A canvas measures as the DOM draws: the same font, the same shaping.

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The platform's UI font: text without a family is set in it. */
export const UI_FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/** CSS's generic families, which the platform resolves (natively too). */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
]);

/**
 * A family name as CSS: one name, as natively, quoted unless it is generic
 * (so a name with digits or punctuation, 'Inter 18pt', still works); '' is
 * the platform's UI font.
 */
export function fontFamilyCss(name: string): string {
  if (name === '') return UI_FONT;
  const quoted = GENERIC_FAMILIES.has(name.toLowerCase())
    ? name
    : `"${name.replace(/["\\]/g, '\\$&')}"`;
  return `${quoted}, system-ui, sans-serif`;
}

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
  return `${italic ? 'italic' : 'normal'} ${weight} ${size}px ${fontFamilyCss(family)}`;
}

/** The size metrics are read at: whole pixels there are fractions of an em. */
const METRICS_SIZE = 1000;

/** A line's baseline, from the line's top. */
export interface Baselines {
  /** Where the engine puts it: from the font's true metrics. */
  readonly engine: number;
  /** Where the browser puts it, left alone. */
  readonly browser: number;
}

export class TextMeasurer {
  #context: Context;
  #font = '';
  #baselines = new Map<string, Baselines | null>();

  private constructor(context: Context) {
    // Kerned, as the DOM draws it: 'auto' would let the canvas skip kerning
    // that an element applies, a pixel's difference in a line of 20px text.
    context.fontKerning = 'normal';
    this.#context = context;
  }

  /** A measurer, or null where there is no canvas to measure with. */
  static create(): TextMeasurer | null {
    let context: Context | null = null;
    try {
      context =
        typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(1, 1).getContext('2d')
          : typeof document === 'object'
            ? document.createElement('canvas').getContext('2d')
            : null;
    } catch {
      context = null;
    }
    // A page without canvases (a test's DOM) has a getContext that gives
    // nothing, or a context that measures nothing.
    if (context === null || typeof context.measureText !== 'function')
      return null;
    return new TextMeasurer(context);
  }

  /** The width of `text` on one line. */
  measure(
    family: string,
    size: number,
    weight: number,
    italic: boolean,
    text: string,
  ): number {
    this.#use(cssFont(family, size, weight, italic));
    return this.#context.measureText(text).width;
  }

  /** The font's ascent and descent, read where rounding does not matter. */
  metrics(
    family: string,
    size: number,
    weight: number,
    italic: boolean,
  ): [number, number] {
    this.#use(cssFont(family, METRICS_SIZE, weight, italic));
    const metrics = this.#context.measureText('x');
    return [
      (metrics.fontBoundingBoxAscent * size) / METRICS_SIZE,
      (metrics.fontBoundingBoxDescent * size) / METRICS_SIZE,
    ];
  }

  /**
   * Where a line's baseline is, set in `font` (cssFont()) and `lineHeight`
   * tall: the engine's, and the browser's. A browser rounds a font's ascent
   * and descent to whole pixels, each rounding its own way and, in Chromium,
   * differently at each device pixel ratio: a 13px line's baseline moves a
   * whole pixel between 1x and 2x, and text sits visibly high in a button.
   * The engine keeps the fractions; its baseline is worked out from the
   * font's true metrics, against where the browser really puts it. Null in
   * a document that does no layout.
   */
  baselines(
    document: Document,
    font: string,
    size: number,
    lineHeight: number,
  ): Baselines | null {
    const ratio = document.defaultView?.devicePixelRatio ?? 1;
    const key = `${font}\0${lineHeight}\0${ratio}`;
    const known = this.#baselines.get(key);
    if (known !== undefined) return known;

    this.#use(font.replace(` ${size}px `, ` ${METRICS_SIZE}px `));
    const metrics = this.#context.measureText('x');
    const ascent = (metrics.fontBoundingBoxAscent * size) / METRICS_SIZE;
    const descent = (metrics.fontBoundingBoxDescent * size) / METRICS_SIZE;

    // In the page itself, where no scale of the view's applies.
    const host = document.createElement('div');
    host.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:pre;font:${font};line-height:${lineHeight}px`;
    const probe = document.createElement('span');
    probe.style.cssText =
      'display:inline-block;width:0;height:0;vertical-align:baseline';
    host.append('x', probe);
    document.body.append(host);
    const actual =
      probe.getBoundingClientRect().bottom - host.getBoundingClientRect().top;
    host.remove();

    const engine = (lineHeight - (ascent + descent)) / 2 + ascent;
    const result = Number.isFinite(engine) ? { engine, browser: actual } : null;
    this.#baselines.set(key, result);
    return result;
  }

  /** Forgets what it measured: fonts have changed. */
  reset(): void {
    this.#baselines = new Map();
    this.#font = '';
  }

  #use(font: string): void {
    // Setting it parses it: only when it changes.
    if (font === this.#font) return;
    this.#context.font = font;
    this.#font = font;
  }
}
