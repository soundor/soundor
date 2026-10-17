import { llms, loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { defineDocs } from 'fumadocs-mdx/macro';

import { fillPlaceholders } from './placeholders';
import { docsRoute } from './shared';
import { siteValues } from './site-values';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    async: true,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: docsRoute,
  plugins: [lucideIconsPlugin()],
});

export const docsLlms = llms(source, {
  // The processed Markdown is made without our remark plugins: fill in the
  // placeholders here too, so agents read real versions.
  renderPage: async (page) =>
    fillPlaceholders(
      `# ${page.data.title} (${page.url})\n\n${await page.data.getText('processed')}`,
      siteValues,
      page.path,
    ),
});
