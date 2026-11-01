import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

import { appName, repository } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          {/* The wordmark is outlined in the theme's ink: one file per theme. */}
          <img
            src="/soundor-logo.svg"
            alt={appName}
            height={28}
            className="h-7 w-auto dark:hidden"
          />
          <img
            src="/soundor-logo-dark-bg.svg"
            alt={appName}
            height={28}
            className="hidden h-7 w-auto dark:block"
          />
        </>
      ),
    },
    githubUrl: repository.url,
    links: [
      { text: 'Docs', url: '/docs', active: 'url' },
      { text: 'Components', url: '/docs/components', active: 'nested-url' },
      { text: 'Examples', url: '/docs/examples/orbit', active: 'nested-url' },
    ],
  };
}
