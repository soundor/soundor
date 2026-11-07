import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { defineDocs } from 'fumadocs-mdx/macro';

import { getContentUrl } from './content-urls';
import { docsRoute } from './shared';

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
  url: getContentUrl,
  pageTree: {
    transformers: [
      {
        file(node, path) {
          if (path && /^changelog\/[^/]+\/index\.md$/.test(path))
            return { ...node, name: 'Overview' };
          return node;
        },
      },
    ],
  },
  plugins: [lucideIconsPlugin()],
});
