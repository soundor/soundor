import { createFileRoute } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';

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
      <main className="mx-auto w-full max-w-5xl px-4 py-16">
        <p className="mb-2 font-mono text-xs tracking-wider text-fd-primary uppercase">
          Plugins
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Made with Soundor
        </h1>
        <p className="mt-2 max-w-xl text-fd-muted-foreground">
          The official plugins, built with the same toolchain you use.
        </p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {officialPlugins.map((plugin) => (
            <li
              key={plugin.name}
              className="rounded-xl border bg-fd-card p-5 text-fd-card-foreground"
            >
              <p className="text-xs text-fd-muted-foreground">{plugin.kind}</p>
              <h2 className="mt-1 text-xl font-semibold">{plugin.name}</h2>
              <p className="mt-2 text-sm text-fd-muted-foreground">
                {plugin.description}
              </p>
              <ul
                className="mt-4 flex flex-wrap gap-2"
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
            </li>
          ))}
        </ul>
      </main>
    </HomeLayout>
  );
}
