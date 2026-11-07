import { createFileRoute } from '@tanstack/react-router';

import {
  DocumentationPage,
  documentationHead,
  loadDocumentation,
} from '@/components/documentation-page';

export const Route = createFileRoute('/changelog/$')({
  loader: ({ params }) =>
    loadDocumentation([
      'changelog',
      ...(params._splat?.split('/').filter(Boolean) ?? []),
    ]),
  head: documentationHead,
  component: () => <DocumentationPage data={Route.useLoaderData()} />,
});
