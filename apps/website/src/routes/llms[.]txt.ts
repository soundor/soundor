import { createFileRoute } from '@tanstack/react-router';

import { docsLlms } from '@/lib/llms';

export const Route = createFileRoute('/llms.txt')({
  server: {
    handlers: {
      GET: async () => new Response(await docsLlms.index()),
    },
  },
});
