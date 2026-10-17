import { llms } from 'fumadocs-core/source';

import { fillPlaceholders } from './placeholders';
import { siteValues } from './site-values';
import { inlineSnippets } from './snippet-markdown';
import { source } from './source';

/** The snippets' code, for the Markdown pages (server only: route handlers). */
const snippets = import.meta.glob<string>(
  '../../../../examples/snippets/src/snippets/*.tsx',
  { query: '?raw', import: 'default', eager: true },
);
const snippetCode = (name: string): string | undefined =>
  snippets[`../../../../examples/snippets/src/snippets/${name}.tsx`];

export const docsLlms = llms(source, {
  // The processed Markdown is made without our remark plugins: fill in the
  // placeholders and the snippets' code here too, so agents read real
  // versions and real code.
  renderPage: async (page) =>
    inlineSnippets(
      fillPlaceholders(
        `# ${page.data.title} (${page.url})\n\n${await page.data.getText('processed')}`,
        siteValues,
        page.path,
      ),
      snippetCode,
    ),
});
