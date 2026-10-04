import { describe, expect, it } from 'vitest';

import { cssFor, cssText, pointerClass, readStyle } from './style';

describe('cssFor', () => {
  it('writes nothing for an empty style: the stylesheet has Yoga defaults', () => {
    expect(cssFor({}, 'view')).toEqual({});
  });

  it('maps numbers to pixels, keeps percentages and auto', () => {
    expect(
      cssFor(
        { width: 100, height: '50%', flexBasis: 'auto', minWidth: 10 },
        'view',
      ),
    ).toEqual({
      width: '100px',
      height: '50%',
      'flex-basis': 'auto',
      'min-width': '10px',
    });
  });

  it('reads flex as React Native does, with the longhands winning', () => {
    expect(cssFor({ flex: 2 }, 'view')).toEqual({
      'flex-grow': '2',
      'flex-shrink': '1',
      'flex-basis': '0px',
    });
    expect(cssFor({ flex: -1 }, 'view')).toEqual({ 'flex-shrink': '1' });
    expect(cssFor({ flex: 0 }, 'view')).toEqual({});
    expect(cssFor({ flex: 1, flexShrink: 0, flexBasis: 20 }, 'view')).toEqual({
      'flex-grow': '1',
      'flex-shrink': '0',
      'flex-basis': '20px',
    });
  });

  it('resolves edges: one side, then the axis, then all', () => {
    expect(
      cssFor(
        { margin: 1, marginHorizontal: 2, marginLeft: 3, padding: '5%' },
        'view',
      ),
    ).toEqual({
      'margin-top': '1px',
      'margin-right': '2px',
      'margin-bottom': '1px',
      'margin-left': '3px',
      'padding-top': '5%',
      'padding-right': '5%',
      'padding-bottom': '5%',
      'padding-left': '5%',
    });
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
    expect(cssFor({ inset: 0, left: 10, gap: 4, rowGap: 8 }, 'view')).toEqual({
      top: '0px',
      right: '0px',
      bottom: '0px',
      left: '10px',
      'row-gap': '8px',
      'column-gap': '4px',
    });
  });

  it('clips with overflow scroll except in scroll views, which always scroll', () => {
    expect(cssFor({ overflow: 'scroll' }, 'view')).toEqual({
      overflow: 'hidden',
    });
    expect(cssFor({ overflow: 'hidden' }, 'scroll')).toEqual({});
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

  it('cuts text at numberOfLines', () => {
    expect(cssFor({ numberOfLines: 2, lineHeight: 10 }, 'text')).toMatchObject({
      'max-height': '20px',
      overflow: 'hidden',
    });
    expect(cssFor({ numberOfLines: 0 }, 'text')).not.toHaveProperty(
      'max-height',
    );
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

  it('hides with display none and serializes', () => {
    const css = cssFor({ display: 'none', position: 'absolute' }, 'view');
    expect(cssText(css)).toBe('display:none;position:absolute;');
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
