/**
 * Serves the plugin's web build (`.soundor/dist/web`) as a static site: a
 * file, or a folder's index.html, else 404. For the browser tests
 * (`pnpm test:web`), and to open a build by hand.
 *
 *   node scripts/serve.ts [port]
 */

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = new URL('../.soundor/dist/web/', import.meta.url).pathname;
const port = Number(process.argv[2] ?? 4175);

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function file(path: string): string | undefined {
  try {
    const stats = statSync(path);
    if (stats.isFile()) return path;
    if (stats.isDirectory()) return file(join(path, 'index.html'));
  } catch {
    // Not there.
  }
  return undefined;
}

createServer((request, response) => {
  const pathname = decodeURIComponent(
    new URL(request.url ?? '/', 'http://localhost').pathname,
  );
  // normalize() resolves `..` before the join, so nothing outside the root.
  const found = file(join(root, normalize(pathname)));
  if (!found) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  response.writeHead(200, {
    'content-type': types[extname(found)] ?? 'application/octet-stream',
  });
  createReadStream(found).pipe(response);
}).listen(port, () =>
  console.log(`Serving .soundor/dist/web on http://localhost:${port}/`),
);
