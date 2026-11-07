import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { defineDocs } from 'fumadocs-mdx/macro';
import { createElement, Fragment } from 'react';

import { BreakingChangeIcon } from '../components/breaking-change-icon';
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
          if (path && /^changelog\/[^/]+\/index\.mdx?$/.test(path))
            return { ...node, name: 'Overview' };
          if (
            path?.startsWith('changelog/') &&
            typeof node.name === 'string' &&
            node.name.endsWith(' ⚠')
          ) {
            return {
              ...node,
              name: createElement(
                Fragment,
                null,
                node.name.slice(0, -2),
                createElement(BreakingChangeIcon),
              ),
            };
          }
          return node;
        },
      },
    ],
  },
  plugins: [lucideIconsPlugin()],
});
