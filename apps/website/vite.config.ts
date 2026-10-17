import { glob } from 'node:fs/promises';

import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { getSlugs } from 'fumadocs-core/source';
import { fumadocsMdx } from 'fumadocs-mdx/vite';
import convert from 'npm-to-yarn';
import { defineConfig } from 'vite';

import { remarkPlaceholders } from './plugins/remark-placeholders.ts';
import { siteValues } from './plugins/values.ts';

const values = siteValues();

// Every page, and its Markdown twin, is prerendered: crawling links alone
// misses pages nothing links to (the Contribute tab's).
const pages = [
  { path: '/api/search' },
  { path: '/llms.txt' },
  { path: '/llms-full.txt' },
];
for await (const file of glob('**/*.{md,mdx}', { cwd: 'content/docs' })) {
  const slugs = getSlugs(file);
  const url = ['/docs', ...slugs].join('/');
  pages.push(
    { path: url },
    { path: `${slugs.length === 0 ? '/docs/index' : url}.md` },
  );
}

/** Install commands as tabs for the package managers Soundor supports. */
const packageManagers = (['pnpm', 'npm'] as const).map((name) => ({
  name,
  command: (command: string) =>
    command
      .split('\n')
      .map((line) => convert(line, name))
      .join('\n'),
}));

export default defineConfig({
  define: {
    __SITE_VALUES__: JSON.stringify(values),
  },
  plugins: [
    fumadocsMdx({
      globalOptions: {
        mdxOptions: {
          remarkPlugins: (defaults) => [
            remarkPlaceholders(values),
            ...defaults,
          ],
          remarkNpmOptions: { packageManagers, persist: { id: 'pm' } },
        },
      },
    }),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
        failOnError: true,
        // The examples are static builds, copied into public/ as they are.
        filter: (page) => !page.path.startsWith('/examples/'),
      },
      pages,
    }),
    react(),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: 'tslib/tslib.es6.js',
    },
  },
});
