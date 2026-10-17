import { glob } from 'node:fs/promises';

import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { getSlugs } from 'fumadocs-core/source';
import { fumadocsMdx } from 'fumadocs-mdx/vite';
import { defineConfig } from 'vite';

import { packageManagers } from './plugins/package-managers.ts';
import { remarkPlaceholders } from './plugins/remark-placeholders.ts';
import { siteValues } from './plugins/values.ts';
import { serveFile } from './scripts/static.ts';

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

export default defineConfig({
  define: {
    __SITE_VALUES__: JSON.stringify(values),
  },
  plugins: [
    {
      // The folders the build scripts write into public/, served from disk
      // under `vite dev`: Vite's list of public files goes stale when they
      // are rewritten while it runs (an example rebuilt, say).
      name: 'soundor:synced-public',
      configureServer(server) {
        const publicDir = new URL('./public', import.meta.url).pathname;
        server.middlewares.use((request, response, next) => {
          const url = request.url ?? '';
          if (
            !(url.startsWith('/examples/') || url.startsWith('/playground/')) ||
            !serveFile(publicDir, request, response)
          ) {
            next();
          }
        });
      },
    },
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
  // The editor's worker: TypeScript (CommonJS), bundled once, not on load.
  optimizeDeps: { include: ['typescript-6'] },
  worker: { format: 'es' },
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: 'tslib/tslib.es6.js',
    },
  },
});
