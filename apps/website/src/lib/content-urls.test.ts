import { describe, expect, it } from 'vitest';

import { getContentMarkdownUrl, getContentUrl } from './content-urls';

describe('content URLs', () => {
  it('keeps documentation under docs and gives changelogs their own public path', () => {
    expect(getContentUrl([])).toBe('/docs');
    expect(getContentUrl(['getting-started'])).toBe('/docs/getting-started');
    expect(getContentUrl(['changelog'])).toBe('/changelog');
    expect(getContentUrl(['changelog', 'vst3-runtime'])).toBe(
      '/changelog/vst3-runtime',
    );
    expect(getContentUrl(['changelog', 'vst3-runtime', '0.14.0'])).toBe(
      '/changelog/vst3-runtime/0.14.0',
    );
  });

  it('provides Markdown twins for root, overview and release pages', () => {
    expect(getContentMarkdownUrl([]).url).toBe('/docs/index.md');
    expect(getContentMarkdownUrl(['changelog']).url).toBe(
      '/changelog/index.md',
    );
    expect(getContentMarkdownUrl(['changelog', 'vst3-runtime']).url).toBe(
      '/changelog/vst3-runtime.md',
    );
    expect(
      getContentMarkdownUrl(['changelog', 'vst3-runtime', '0.14.0']).url,
    ).toBe('/changelog/vst3-runtime/0.14.0.md');
  });
});
