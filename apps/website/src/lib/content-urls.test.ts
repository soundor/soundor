import { describe, expect, it } from 'vitest';

import { getContentMarkdownUrl, getContentUrl } from './content-urls';

describe('content URLs', () => {
  it('keeps documentation under docs and gives changelogs their own public path', () => {
    expect(getContentUrl([])).toBe('/docs');
    expect(getContentUrl(['getting-started'])).toBe('/docs/getting-started');
    expect(getContentUrl(['changelog'])).toBe('/changelog');
    expect(getContentUrl(['changelog', 'juce-runtime'])).toBe(
      '/changelog/juce-runtime',
    );
    expect(getContentUrl(['changelog', 'juce-runtime', '0.14.0'])).toBe(
      '/changelog/juce-runtime/0.14.0',
    );
  });

  it('provides Markdown twins for root, overview and release pages', () => {
    expect(getContentMarkdownUrl([]).url).toBe('/docs/index.md');
    expect(getContentMarkdownUrl(['changelog']).url).toBe(
      '/changelog/index.md',
    );
    expect(getContentMarkdownUrl(['changelog', 'juce-runtime']).url).toBe(
      '/changelog/juce-runtime.md',
    );
    expect(
      getContentMarkdownUrl(['changelog', 'juce-runtime', '0.14.0']).url,
    ).toBe('/changelog/juce-runtime/0.14.0.md');
  });
});
