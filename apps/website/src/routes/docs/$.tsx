import { createFileRoute, redirect } from '@tanstack/react-router';

import {
  DocumentationPage,
  documentationHead,
  loadDocumentation,
} from '@/components/documentation-page';
import { getContentUrl } from '@/lib/content-urls';

export const Route = createFileRoute('/docs/$')({
  loader: ({ params }) => {
    const slugs = params._splat?.split('/').filter(Boolean) ?? [];
    if (slugs[0] === 'changelog')
      throw redirect({ href: getContentUrl(slugs) });
    return loadDocumentation(slugs);
  },
  head: documentationHead,
  component: () => <DocumentationPage data={Route.useLoaderData()} />,
});
