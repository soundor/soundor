import { HomeLayout } from 'fumadocs-ui/layouts/home';
import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/site-footer';
import { baseOptions } from '@/lib/layout.shared';

/**
 * A standalone page of prose, such as the Privacy Policy: the site's header,
 * a readable column with the docs' typography, and the footer.
 */
export function LegalPage({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <p className="mb-2 font-mono text-xs tracking-wider text-fd-primary uppercase">
          {eyebrow}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <div className="mt-3 text-fd-muted-foreground">{lead}</div>
        <article className="prose mt-10 max-w-none">{children}</article>
      </main>
      <SiteFooter />
    </HomeLayout>
  );
}
