/**
 * Serves the built site (`dist/client`) as GitHub Pages does: a file, or a
 * folder's index.html, else 404. For the browser tests, and to look at a build
 * the way it will be deployed (`vite preview` serves it differently).
 *
 *   node scripts/serve.ts [port]
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../dist/client/', import.meta.url).pathname;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function fileFor(pathname: string): string | undefined {
  const path = normalize(join(ROOT, decodeURIComponent(pathname)));
  if (!path.startsWith(ROOT.replace(/\/$/, ''))) return undefined;
  if (existsSync(path) && statSync(path).isFile()) return path;
  const index = join(path, 'index.html');
  return existsSync(index) ? index : undefined;
}

const port = Number(process.argv[2] ?? 4321);
createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  // GitHub Pages redirects a folder without its slash; so does this.
  const file = fileFor(pathname);
  if (
    file?.endsWith('/index.html') &&
    !pathname.endsWith('/') &&
    !pathname.endsWith('.html')
  ) {
    response.writeHead(301, { location: `${pathname}/` }).end();
    return;
  }
  if (file === undefined) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
}).listen(port, () =>
  console.log(`Serving dist/client on http://localhost:${port}/`),
);
