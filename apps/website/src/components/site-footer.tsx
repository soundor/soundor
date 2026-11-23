import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { repository } from '@/lib/shared';

/** The year the copyright starts, as in the repository's LICENSE. */
const firstYear = 2025;
/** The year the page was built: the site is rebuilt with every release. */
const year = new Date().getFullYear();
const years = year > firstYear ? `${firstYear}–${year}` : `${firstYear}`;

const link = 'hover:text-fd-foreground focus-visible:text-fd-foreground';

/**
 * The legal line every page ends with: the copyright, the software's
 * license, and the Soundor-wide Privacy Policy and Brand Guidelines.
 */
function Legal() {
  return (
    <div className="flex flex-col gap-2 text-xs text-fd-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p>
        © <span suppressHydrationWarning>{years}</span> Dmitrii Balakin.
        Soundor’s software is released under the{' '}
        <a
          className={`underline underline-offset-2 ${link}`}
          href={`${repository.url}/blob/${repository.branch}/LICENSE`}
        >
          MIT License
        </a>
        .
      </p>
      <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
        <Link className={link} to="/privacy">
          Privacy
        </Link>
        <Link className={link} to="/brand">
          Brand
        </Link>
      </nav>
    </div>
  );
}

/** The footer of the home page and the site's other standalone pages. */
export function SiteFooter({ children }: { children?: ReactNode }) {
  return (
    <footer role="contentinfo" className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 text-sm text-fd-muted-foreground">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {children}
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link className={link} to="/docs/$" params={{ _splat: '' }}>
              Docs
            </Link>
            <Link className={link} to="/changelog/$" params={{ _splat: '' }}>
              Changelog
            </Link>
            <Link className={link} to="/plugins">
              Plugins
            </Link>
            <a className={link} href={repository.url}>
              GitHub
            </a>
            <a className={link} href="https://components.soundor.dev/">
              Components
            </a>
            <a className={link} href="https://icons.soundor.dev/">
              Icons
            </a>
          </nav>
        </div>
        <div className="border-t pt-6">
          <Legal />
        </div>
      </div>
    </footer>
  );
}

/** The legal line under a documentation page, after its previous/next links. */
export function PageLegal() {
  return (
    <footer className="mt-10 border-t pt-6">
      <Legal />
    </footer>
  );
}
