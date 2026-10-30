// registerFont() in the browser: a bundled font file as a FontFace of the
// page, which the DOM and canvases set text in. Arguments are checked, and
// errors worded, as in the JUCE runtime (ui.js).

import { assetUrl } from '../assets';
import { isAssetId } from '../protocol';

export interface FontDescriptors {
  weight?: number | 'normal' | 'bold';
  style?: 'normal' | 'italic';
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object')
    return (value as object).constructor?.name ?? 'object';
  return typeof value;
}

/** A value in an error message: strings quoted, numbers as they are. */
function shown(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  return typeof value === 'number' ? String(value) : describe(value);
}

/**
 * Makes a bundled font file a face of `family`, as @font-face does; resolves
 * once it is loaded, rejects if it is not a font.
 */
export function registerFont(
  family: unknown,
  source: unknown,
  descriptors: unknown = {},
): Promise<void> {
  if (typeof family !== 'string' || family === '')
    throw new TypeError(
      `registerFont(): family must be a non-empty string, got ${shown(family)}`,
    );
  if (typeof source !== 'string' || source === '')
    throw new TypeError(
      `registerFont(): source must be a bundled font (import font from './font.ttf'), got ${shown(source)}`,
    );
  if (descriptors === null || typeof descriptors !== 'object')
    throw new TypeError(
      `registerFont(): descriptors must be an object, got ${shown(descriptors)}`,
    );
  const given = descriptors as { weight?: unknown; style?: unknown };
  const raw = given.weight ?? 400;
  const weight =
    raw === 'normal'
      ? 400
      : raw === 'bold'
        ? 700
        : typeof raw === 'number' || typeof raw === 'string'
          ? Number(raw)
          : Number.NaN;
  if (!(weight >= 1 && weight <= 1000))
    throw new TypeError(
      `registerFont(): weight must be a weight from 1 to 1000, 'normal' or 'bold', got ${shown(raw)}`,
    );
  const style = given.style ?? 'normal';
  if (style !== 'normal' && style !== 'italic')
    throw new TypeError(
      `registerFont(): style must be 'normal' or 'italic', got ${shown(style)}`,
    );
  const failed = (): Error =>
    new Error(
      `registerFont(): '${source}' is not a bundled font (TrueType or OpenType)`,
    );
  if (!/\.(ttf|otf)$/.test(source) || !isAssetId(source))
    return Promise.reject(failed());
  const face = new FontFace(
    family,
    `url(${JSON.stringify(assetUrl(source))})`,
    {
      weight: String(Math.trunc(weight)),
      style,
    },
  );
  // Registered first, as natively: text in the family waits for it rather
  // than showing a platform font of the same name.
  document.fonts.add(face);
  return face.load().then(
    () => undefined,
    () => {
      document.fonts.delete(face);
      throw failed();
    },
  );
}
