import { describe, expect, it } from 'vitest';

import { layoutText, type TextMeasurer } from './text-layout';

/** Every character 10 wide: the wrapping alone is what is under test. */
const measurer: TextMeasurer = {
  advance: (text) => text.length * 10,
  baselines: () => null,
  reset() {},
};
const lines = (text: string, width: number, style = {}) =>
  layoutText(measurer, text, style, width).lines;

// As the engine's TextEngine::layout.
describe('layoutText', () => {
  it('breaks only where a word no longer fits', () => {
    expect(lines('aa bb cc', 50)).toEqual(['aa bb', 'cc']);
    expect(lines('aa bb cc', Infinity)).toEqual(['aa bb cc']);
  });

  it('gives a word wider than the line a line of its own', () => {
    expect(lines('aa bbbbbbbb cc', 30)).toEqual(['aa', 'bbbbbbbb', 'cc']);
  });

  it('never breaks but at spaces, unlike a browser', () => {
    expect(lines('well-known-word', 30)).toEqual(['well-known-word']);
    expect(lines('日本語のラベル', 30)).toEqual(['日本語のラベル']);
  });

  it('keeps line breaks and empty lines', () => {
    expect(lines('a\n\nb', 100)).toEqual(['a', '', 'b']);
    expect(lines('', 100)).toEqual(['']);
  });

  it('keeps leading spaces with the first word of a line', () => {
    expect(lines('  aa bb', 40)).toEqual(['  aa', 'bb']);
  });

  it('stops at numberOfLines, which sizes it too', () => {
    const cut = layoutText(measurer, 'aaaaa bb cc', { numberOfLines: 2 }, 30);
    expect(cut.lines).toEqual(['aaaaa', 'bb']);
    expect(cut.width).toBe(50);
    expect(cut.height).toBeCloseTo(2 * 14 * 1.2);
  });

  it('is as wide as its widest line and as tall as its lines', () => {
    const set = layoutText(measurer, 'aaa b', { lineHeight: 20 }, 30);
    expect(set).toEqual({ lines: ['aaa', 'b'], width: 30, height: 40 });
  });
});
