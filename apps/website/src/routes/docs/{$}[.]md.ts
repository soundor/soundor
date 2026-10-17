import { createFileRoute, notFound } from '@tanstack/react-router';

import { docsLlms } from '@/lib/llms';
import { decodeMarkdownUrl } from '@/lib/shared';
import { source } from '@/lib/source';

export const Route = createFileRoute('/docs/{$}.md')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = decodeMarkdownUrl(params._splat?.split('/') ?? []);
        const page = source.getPage(slugs);
        if (!page) throw notFound();

        return new Response(await docsLlms.page(page), {
          headers: {
            'Content-Type': 'text/markdown',
          },
        });
      },
    },
  },
});
