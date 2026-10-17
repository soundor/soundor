/**
 * Serving built files as GitHub Pages does: a file, or a folder's
 * index.html. Used by `serve.ts` (the built site) and, in `vite dev`, for the
 * folders the build scripts write into `public/` (Vite's own list of public
 * files goes stale when they are rewritten while it runs).
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

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

/** The file under `root` a request path is served from, if any. */
export function fileFor(root: string, pathname: string): string | undefined {
  const base = normalize(root).replace(/[\\/]$/, '');
  const path = normalize(join(base, decodeURIComponent(pathname)));
  if (path !== base && !path.startsWith(base + sep)) return undefined;
  if (existsSync(path) && statSync(path).isFile()) return path;
  const index = join(path, 'index.html');
  return existsSync(index) ? index : undefined;
}

/**
 * Answers `request` from `root`; false when there is no such file (the caller
 * answers 404, or lets another handler try).
 */
export function serveFile(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  const file = fileFor(root, pathname);
  if (file === undefined) return false;
  // As GitHub Pages: a folder without its slash is redirected to it.
  if (
    file.endsWith(`${sep}index.html`) &&
    !pathname.endsWith('/') &&
    !pathname.endsWith('.html')
  ) {
    response.writeHead(301, { location: `${pathname}/` }).end();
    return true;
  }
  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
  return true;
}
