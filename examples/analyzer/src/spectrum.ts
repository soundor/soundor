// What the UI does with a spectrum: shared by the drawing and its tests.

/** The floor and ceiling of the display, in decibels. */
export const FLOOR_DB = -96;
export const CEILING_DB = 0;

/** A level in decibels as a fraction of the display's height, 0 to 1. */
export function heightOf(decibels: number): number {
  const fraction = (decibels - FLOOR_DB) / (CEILING_DB - FLOOR_DB);
  return Math.min(1, Math.max(0, fraction));
}

/**
 * Bars that rise at once and fall slowly, as an analyzer's do: each band of
 * `held` follows `spectrum` up, and falls by at most `fall` (a fraction of
 * the height) a frame.
 */
export function hold(
  held: Float32Array,
  spectrum: Float32Array,
  fall: number,
): Float32Array {
  const next =
    held.length === spectrum.length ? held : new Float32Array(spectrum.length);
  for (let band = 0; band < spectrum.length; band++) {
    const target = heightOf(spectrum[band]!);
    const current = held.length === spectrum.length ? held[band]! : 0;
    next[band] = Math.max(target, current - fall);
  }
  return next;
}
