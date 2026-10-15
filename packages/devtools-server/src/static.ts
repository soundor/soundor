import { readFile, realpath, stat } from 'node:fs/promises';
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import type { FastifyRequest, FastifyReply } from 'fastify';

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    !isAbsolute(rel) &&
    rel !== '..' &&
    !rel.startsWith('..' + sep) &&
    !rel.split(sep).some((part) => part.startsWith('.'))
  );
}

/** Serves regular files and extensionless SPA navigation, confined to root. */
export async function serveStatic(
  directory: string,
  request: FastifyRequest,
  response: FastifyReply,
): Promise<boolean> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  let path: string;
  try {
    path = decodeURIComponent((request.raw.url ?? '/').split('?')[0]!);
  } catch {
    return false;
  }
  if (
    !path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.includes('%') ||
    /\.(pem|key|p12|pfx)$/i.test(path) ||
    path.split('/').some((part) => part.startsWith('.')) ||
    /^\/(browser|runtime|api)(\/|$)/.test(path)
  )
    return false;
  try {
    const root = await realpath(directory);
    let file = resolve(root, '.' + path);
    if (!inside(root, file)) return false;
    // Check existing ancestors before SPA fallback too: a missing child of an
    // escaping directory symlink must never become a navigation response.
    let ancestor = file;
    for (;;) {
      try {
        if (!inside(root, await realpath(ancestor))) return false;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
        if (ancestor === root) return false;
        ancestor = dirname(ancestor);
      }
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error('Not a file');
    } catch {
      // File-like paths and asset namespaces must never receive HTML.
      if (
        extname(path) ||
        path.startsWith('/assets/') ||
        (path !== '/' && !request.headers.accept?.includes('text/html'))
      )
        return false;
      file = resolve(root, 'index.html');
    }
    const actual = await realpath(file);
    if (
      !inside(root, actual) ||
      /\.(pem|key|p12|pfx)$/i.test(actual) ||
      !(await stat(actual)).isFile()
    )
      return false;
    const data = await readFile(actual);
    const html = extname(actual) === '.html';
    response.code(200).headers({
      'Content-Type':
        mime[extname(actual).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': data.byteLength,
      'Cache-Control': html
        ? 'no-cache'
        : /[-.][a-zA-Z0-9_-]{8,}\.[^.]+$/.test(actual)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    response.send(request.method === 'HEAD' ? undefined : data);
    return true;
  } catch {
    return false;
  }
}
