import { createGetUrl } from 'fumadocs-core/source';

import { siteValues } from './site-values';

export const appName = 'Soundor';
export const docsRoute = '/docs';

/** The docs' sources, for "Edit on GitHub" links. */
export const repository = {
  url: 'https://github.com/soundor/soundor',
  branch: 'main',
  contentDir: 'apps/website/content/docs',
};

/** The current Soundor release: the `soundor` CLI's version. */
export const soundorVersion = siteValues.versions['soundor']!;

const getDocsUrl = createGetUrl(docsRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs];
  if (segments.length === 0) {
    segments.push('index.md');
  } else {
    segments[segments.length - 1] += '.md';
  }

  return { segments, url: getDocsUrl(segments, page.locale) };
}

/** @returns page slugs */
export function decodeMarkdownUrl(segments: string[]) {
  if (segments.length === 0) return [];

  const out = [...segments];
  out[out.length - 1] = out[out.length - 1]!.replace(/\.md$/, '');
  if (out.length === 1 && out[0] === 'index') out.pop();
  return out;
}
