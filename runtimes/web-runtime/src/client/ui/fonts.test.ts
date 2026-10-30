// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerFont } from './fonts';

const FONT = '0123456789abcdef.ttf';

/** A FontFace that loads (or fails), and the page's font set. */
function stubFonts(loads: boolean) {
  const faces: FakeFontFace[] = [];
  class FakeFontFace {
    constructor(
      readonly family: string,
      readonly source: string,
      readonly descriptors: FontFaceDescriptors,
    ) {
      faces.push(this);
    }
    load() {
      return loads
        ? Promise.resolve(this)
        : Promise.reject(new DOMException('bad font', 'SyntaxError'));
    }
  }
  const added = new Set<FakeFontFace>();
  vi.stubGlobal('FontFace', FakeFontFace);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      add: (face: FakeFontFace) => added.add(face),
      delete: (face: FakeFontFace) => added.delete(face),
    },
  });
  return { faces, added };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerFont', () => {
  it('adds a bundled font to the page as a face of the family', async () => {
    const { faces, added } = stubFonts(true);
    await expect(
      registerFont('Brand', FONT, { weight: 'bold', style: 'italic' }),
    ).resolves.toBeUndefined();
    expect(faces).toHaveLength(1);
    const [face] = faces;
    expect(face!.family).toBe('Brand');
    expect(face!.source).toBe(
      `url("${new URL(`soundor-assets/${FONT}`, document.baseURI).href}")`,
    );
    expect(face!.descriptors).toEqual({ weight: '700', style: 'italic' });
    expect(added.has(face!)).toBe(true);
    await registerFont('Brand', FONT);
    expect(faces[1]!.descriptors).toEqual({ weight: '400', style: 'normal' });
  });

  it('rejects what is not a bundled font, as the JUCE runtime does', async () => {
    const { faces, added } = stubFonts(false);
    await expect(registerFont('Brand', FONT)).rejects.toThrow(
      `registerFont(): '${FONT}' is not a bundled font (TrueType or OpenType)`,
    );
    expect(added.size).toBe(0);
    await expect(registerFont('Brand', '0123456789abcdef.png')).rejects.toThrow(
      "registerFont(): '0123456789abcdef.png' is not a bundled font (TrueType or OpenType)",
    );
    expect(faces).toHaveLength(1);
  });

  it.each([
    [[''], "registerFont(): family must be a non-empty string, got ''"],
    [
      ['Brand', 3],
      "registerFont(): source must be a bundled font (import font from './font.ttf'), got 3",
    ],
    [
      ['Brand', FONT, null],
      'registerFont(): descriptors must be an object, got null',
    ],
    [
      ['Brand', FONT, { weight: 0 }],
      "registerFont(): weight must be a weight from 1 to 1000, 'normal' or 'bold', got 0",
    ],
    [
      ['Brand', FONT, { style: 'oblique' }],
      "registerFont(): style must be 'normal' or 'italic', got 'oblique'",
    ],
  ])('throws a TypeError for %j', (args, message) => {
    stubFonts(true);
    expect(() =>
      (registerFont as (...args: unknown[]) => unknown)(...args),
    ).toThrow(new TypeError(message));
  });
});
