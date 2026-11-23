import { createFileRoute, Link } from '@tanstack/react-router';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { ArrowRight, ArrowUpRight } from 'lucide-react';

import { officialPlugins } from '@/components/plugins/plugins';
import { baseOptions } from '@/lib/layout.shared';

export const Route = createFileRoute('/plugins')({
  head: () => ({
    meta: [
      { title: 'Plugins | Soundor' },
      {
        name: 'description',
        content: 'The audio plugins made by the Soundor project.',
      },
    ],
  }),
  component: Plugins,
});

function Plugins() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto w-full max-w-6xl px-4 py-16">
        <p className="mb-2 font-mono text-xs tracking-wider text-fd-primary uppercase">
          Plugins
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Made with Soundor
        </h1>
        <p className="mt-2 max-w-xl text-fd-muted-foreground">
          The official plugins, built with the same toolchain you use.
        </p>
        <ul className="mt-12 space-y-20">
          {officialPlugins.map((plugin, index) => (
            <li
              key={plugin.name}
              className="grid items-center gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-12"
            >
              <a
                href={plugin.url}
                tabIndex={-1}
                aria-hidden
                className="block overflow-hidden rounded-xl border shadow-2xl shadow-black/10 transition-colors hover:border-fd-primary dark:shadow-black/40"
              >
                <img
                  src={plugin.image.src}
                  srcSet={plugin.image.srcSet}
                  sizes="(min-width: 1024px) 640px, 100vw"
                  alt=""
                  width={plugin.image.width}
                  height={plugin.image.height}
                  // The first image is what the page paints largest.
                  loading={index === 0 ? 'eager' : 'lazy'}
                  fetchPriority={index === 0 ? 'high' : 'auto'}
                  className="aspect-[4/3] w-full object-cover"
                />
              </a>
              <div>
                <p className="font-mono text-xs tracking-wider text-fd-primary uppercase">
                  {plugin.kind}
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                  {plugin.name}
                </h2>
                <p className="mt-4 text-fd-muted-foreground">
                  {plugin.description}
                </p>
                <ul
                  className="mt-5 flex flex-wrap gap-2"
                  aria-label={`${plugin.name} formats`}
                >
                  {plugin.formats.map((format) => (
                    <li
                      key={format}
                      className="rounded-md border px-2 py-0.5 font-mono text-xs"
                    >
                      {format}
                    </li>
                  ))}
                </ul>
                <a
                  href={plugin.url}
                  className={buttonVariants({
                    variant: 'primary',
                    className: 'mt-8 gap-1.5 px-4 py-2.5',
                  })}
                >
                  Visit {plugin.name}
                  <ArrowUpRight aria-hidden className="size-4" />
                </a>
              </div>
            </li>
          ))}
        </ul>
        <section
          aria-labelledby="create-title"
          className="mt-24 overflow-hidden rounded-2xl border bg-fd-card p-8 text-center sm:p-12"
        >
          <h2
            id="create-title"
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Don’t wait. Make your own plugin.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-fd-muted-foreground">
            Write the interface in React and the sound in Rust. Soundor builds
            it for your DAW and the browser.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              className={buttonVariants({
                variant: 'primary',
                className: 'gap-1.5 px-4 py-2.5',
              })}
              to="/docs/$"
              params={{ _splat: 'getting-started' }}
            >
              Get started
              <ArrowRight aria-hidden className="size-4" />
            </Link>
            <Link
              className={buttonVariants({
                variant: 'outline',
                className: 'px-4 py-2.5',
              })}
              to="/docs/$"
              params={{ _splat: '' }}
            >
              Read the docs
            </Link>
          </div>
        </section>
      </main>
    </HomeLayout>
  );
}
