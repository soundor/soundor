import { describe, expect, it } from 'vitest';

import { cssFor, cssText, pointerClass, readStyle, STYLESHEET } from './style';

describe('cssFor', () => {
  it('writes nothing for an empty style', () => {
    expect(cssFor({}, 'view')).toEqual({});
  });

  it('leaves where a node is and how large to Yoga', () => {
    expect(
      cssFor(
        {
          width: 100,
          height: '50%',
          flex: 1,
          flexDirection: 'row',
          margin: 4,
          padding: 4,
          inset: 0,
          gap: 4,
          position: 'absolute',
          aspectRatio: 2,
          boxSizing: 'content-box',
        },
        'view',
      ),
    ).toEqual({});
  });

  it('draws borders: one side, then the axis, then all', () => {
    expect(
      cssFor(
        { borderWidth: 1, borderVerticalWidth: 2, borderLeftWidth: 4 },
        'view',
      ),
    ).toEqual({
      'border-top-width': '2px',
      'border-right-width': '1px',
      'border-bottom-width': '2px',
      'border-left-width': '4px',
    });
  });

  it('scrolls a view along the axes its style scrolls, and clips the rest', () => {
    expect(cssFor({ overflow: 'scroll' }, 'view')).toEqual({
      'overflow-x': 'auto',
      'overflow-y': 'auto',
    });
    // The axis over the shorthand; 'visible' beside a clipping axis clips.
    expect(cssFor({ overflow: 'scroll', overflowX: 'hidden' }, 'view')).toEqual(
      { 'overflow-x': 'hidden', 'overflow-y': 'auto' },
    );
    expect(cssFor({ overflowY: 'scroll' }, 'view')).toEqual({
      'overflow-x': 'hidden',
      'overflow-y': 'auto',
    });
    // Only a view's children scroll: elsewhere 'scroll' clips.
    expect(cssFor({ overflow: 'scroll' }, 'text')).toMatchObject({
      'overflow-x': 'hidden',
      'overflow-y': 'hidden',
    });
    expect(cssFor({ overflow: 'visible' }, 'view')).toEqual({});
  });

  it('sets text in text and input nodes only, with lines 1.2× the size', () => {
    expect(cssFor({ color: 'red', fontSize: 20 }, 'view')).toEqual({});
    expect(
      cssFor(
        { color: 'red', fontSize: 20, fontWeight: 'bold', textAlign: 'auto' },
        'text',
      ),
    ).toEqual({
      color: 'red',
      'font-size': '20px',
      'font-weight': '700',
      'line-height': '24px',
      'text-align': 'left',
    });
    expect(cssFor({ lineHeight: 30, fontSize: -3 }, 'input')).toEqual({
      'line-height': '30px',
    });
  });

  it('sets a family by its name alone, as the JUCE runtime does', () => {
    const family = (fontFamily: string) =>
      cssFor({ fontFamily }, 'text')['font-family'];
    expect(family('Inter 18pt')).toBe('"Inter 18pt", system-ui, sans-serif');
    expect(family('A "B" \\')).toBe('"A \\"B\\" \\\\", system-ui, sans-serif');
    expect(family('monospace')).toBe('monospace, system-ui, sans-serif');
    expect(family('')).toBeUndefined();
  });

  it('cuts text at numberOfLines', () => {
    expect(cssFor({ numberOfLines: 2 }, 'text')).toMatchObject({
      overflow: 'hidden',
    });
    expect(cssFor({ numberOfLines: 0 }, 'text')).not.toHaveProperty('overflow');
  });

  it('maps visuals: colors, radii, clamped opacity and resize modes', () => {
    expect(
      cssFor(
        {
          backgroundColor: '#fff',
          borderColor: 'blue',
          borderRadius: 4,
          borderTopLeftRadius: 8,
          opacity: 2,
        },
        'view',
      ),
    ).toEqual({
      'background-color': '#fff',
      'border-color': 'blue',
      'border-radius': '4px',
      'border-top-left-radius': '8px',
      opacity: '1',
    });
    expect(cssFor({ resizeMode: 'stretch' }, 'image')).toEqual({
      'object-fit': 'fill',
    });
    expect(cssFor({ resizeMode: 'center' }, 'image')).toEqual({
      'object-fit': 'scale-down',
    });
  });

  it('draws box shadows as CSS, in order, black by default', () => {
    expect(
      cssFor(
        {
          boxShadow: [
            { offsetY: 2, blur: 8, color: 'rgba(0, 0, 0, 0.3)' },
            { inset: true, spread: 1.5 },
          ],
        },
        'view',
      ),
    ).toEqual({
      'box-shadow':
        '0px 2px 8px 0px rgba(0, 0, 0, 0.3), inset 0px 0px 0px 1.5px black',
    });
    expect(cssFor({ boxShadow: [] }, 'view')).toEqual({});
    expect(() =>
      readStyle({ boxShadow: [{ offsetX: 1, blur: null, color: undefined }] }),
    ).not.toThrow();
  });

  it('draws an outline only with a width, solid and black by default', () => {
    expect(
      cssFor(
        { outlineWidth: 2, outlineColor: 'red', outlineOffset: 3 },
        'view',
      ),
    ).toEqual({
      'outline-style': 'solid',
      'outline-width': '2px',
      'outline-color': 'red',
      'outline-offset': '3px',
    });
    expect(cssFor({ outlineWidth: 1 }, 'view')).toEqual({
      'outline-style': 'solid',
      'outline-width': '1px',
      'outline-color': 'black',
    });
    expect(cssFor({ outlineWidth: 0, outlineColor: 'red' }, 'view')).toEqual(
      {},
    );
    expect(() => readStyle({ outlineWidth: '2px' })).toThrow(/outlineWidth/);
    expect(() => readStyle({ outlineColor: 3 })).toThrow(/outlineColor/);
  });

  it('hides with display none and serializes', () => {
    const css = cssFor({ display: 'none', zIndex: 2 }, 'view');
    expect(cssText(css)).toBe('display:none;z-index:2;');
  });
});

describe('zIndex', () => {
  it('stacks as CSS z-index; every node stacks its own children', () => {
    expect(cssFor({ zIndex: 3 }, 'view')).toEqual({ 'z-index': '3' });
    expect(cssFor({ zIndex: -1 }, 'view')).toEqual({ 'z-index': '-1' });
    expect(STYLESHEET).toMatch(/\.sd-node \{[^}]*z-index: 0;/);
  });

  it('must be an integer, as in the JUCE runtime', () => {
    expect(readStyle({ zIndex: 2 })).toEqual({ zIndex: 2 });
    expect(() => readStyle({ zIndex: 1.5 })).toThrow(
      new TypeError('style.zIndex: expected an integer, got 1.5'),
    );
    expect(() => readStyle({ zIndex: '2' })).toThrow(
      new TypeError("style.zIndex: expected an integer, got '2'"),
    );
    expect(() => readStyle({ zIndex: 2 ** 40 })).toThrow(TypeError);
  });
});

describe('pointerClass', () => {
  it('has a class per mode that changes hit testing', () => {
    expect(pointerClass({})).toBe('');
    expect(pointerClass({ pointerEvents: 'auto' })).toBe('');
    expect(pointerClass({ pointerEvents: 'none' })).toBe('sd-pe-none');
    expect(pointerClass({ pointerEvents: 'box-none' })).toBe('sd-pe-box-none');
    expect(pointerClass({ pointerEvents: 'box-only' })).toBe('sd-pe-box-only');
  });
});

describe('readStyle', () => {
  it('drops null and undefined, ignores unknown keys', () => {
    expect(readStyle({ width: null, height: 2, nonsense: 'x' })).toEqual({
      height: 2,
      nonsense: 'x',
    });
    expect(readStyle(undefined)).toEqual({});
  });

  it.each([
    [
      { display: 'grid' },
      "style.display: expected one of 'flex', 'none', got 'grid'",
    ],
    [
      { width: '10px' },
      "style.width: expected a number, a percentage or 'auto', got '10px'",
    ],
    [
      { padding: 'auto' },
      "style.padding: expected a number or a percentage, got 'auto'",
    ],
    [
      { opacity: Number.NaN },
      'style.opacity: expected a finite number, got NaN',
    ],
    [
      { fontWeight: 1200 },
      "style.fontWeight: expected a weight from 1 to 1000, 'normal' or 'bold', got 1200",
    ],
    [{ fontFamily: 3 }, 'style.fontFamily: expected a string, got 3'],
    // The same cases as the engine's UiModule tests.
    [
      { boxShadow: { blur: 2 } },
      'style.boxShadow: expected an array, got [object Object]',
    ],
    [{ boxShadow: [3] }, 'style.boxShadow[0]: expected an object, got 3'],
    [
      { boxShadow: [{}, { blurRadius: 2 }] },
      'style.boxShadow[1]: unsupported property blurRadius',
    ],
    [
      { boxShadow: [{ blur: -1 }] },
      'style.boxShadow[0].blur: expected a finite nonnegative number, got -1',
    ],
    [
      { boxShadow: [{ offsetX: '2px' }] },
      "style.boxShadow[0].offsetX: expected a finite number, got '2px'",
    ],
    [
      { boxShadow: [{ color: 3 }] },
      'style.boxShadow[0].color: expected a CSS color, got 3',
    ],
    [
      { boxShadow: [{ inset: 1 }] },
      'style.boxShadow[0].inset: expected a boolean, got 1',
    ],
  ])('rejects %j as the JUCE runtime does', (style, message) => {
    expect(() => readStyle(style)).toThrow(new TypeError(message));
  });

  it('accepts what the declaration allows', () => {
    expect(() =>
      readStyle({
        width: '12.5%',
        margin: 'auto',
        fontWeight: '600',
        alignSelf: 'auto',
        pointerEvents: 'box-none',
      }),
    ).not.toThrow();
  });

  it('rejects a style that is not an object', () => {
    expect(() => readStyle(3)).toThrow(
      new TypeError('style must be an object, got number'),
    );
  });
});
