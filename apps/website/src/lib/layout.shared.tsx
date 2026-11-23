import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { ExternalLink } from 'lucide-react';

import { appName, repository } from './shared';

/** The other Soundor sites. The sidebar marks external links itself. */
export const siteLinks = [
  {
    text: 'Components',
    url: 'https://components.soundor.dev/',
    external: true,
  },
  { text: 'Icons', url: 'https://icons.soundor.dev/', external: true },
] as const;

/** A link to another Soundor site, marked as leaving this one. */
function External({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <ExternalLink aria-hidden className="size-3" />
    </span>
  );
}

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
      { text: 'Plugins', url: '/plugins', active: 'url' },
      { text: 'Changelog', url: '/changelog', active: 'nested-url' },
      ...siteLinks.map((link) => ({
        ...link,
        text: <External>{link.text}</External>,
      })),
    ],
  };
}
