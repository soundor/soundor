import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

import { appName, repository, soundorVersion } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-baseline gap-2">
          <span className="font-semibold">{appName}</span>
          {/* Plain text: the title is already a link home. */}
          <span className="text-xs font-normal text-fd-muted-foreground">
            v{soundorVersion}
          </span>
        </span>
      ),
    },
    githubUrl: repository.url,
  };
}
