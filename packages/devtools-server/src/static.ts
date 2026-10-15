import { realpath, stat } from 'node:fs/promises';
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import staticPlugin from '@fastify/static';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Authentication } from './authentication';

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    !isAbsolute(rel) &&
    rel !== '..' &&
    !rel.startsWith('..' + sep) &&
    !rel.split(sep).some((part) => part.startsWith('.'))
  );
}

/** Select a confined public file or SPA entry; @fastify/static handles delivery. */
async function resolveStaticFile(
  directory: string,
  request: FastifyRequest,
): Promise<{ root: string; file: string } | undefined> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
  let path: string;
  try {
    path = decodeURIComponent((request.raw.url ?? '/').split('?')[0]!);
  } catch {
    return undefined;
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
    return undefined;
  try {
    const root = await realpath(directory);
    let file = resolve(root, '.' + path);
    if (!inside(root, file)) return undefined;
    // Check existing ancestors before SPA fallback too: a missing child of an
    // escaping directory symlink must never become a navigation response.
    let ancestor = file;
    for (;;) {
      try {
        if (!inside(root, await realpath(ancestor))) return undefined;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          return undefined;
        if (ancestor === root) return undefined;
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
        return undefined;
      file = resolve(root, 'index.html');
    }
    const actual = await realpath(file);
    if (
      !inside(root, actual) ||
      /\.(pem|key|p12|pfx)$/i.test(actual) ||
      !(await stat(actual)).isFile()
    )
      return undefined;
    return { root, file: relative(root, actual) };
  } catch {
    return undefined;
  }
}

/** Standard static delivery with DevTools public-file and SPA fallback rules. */
export async function registerStaticRoutes(
  app: FastifyInstance,
  auth: Authentication,
  directory: string | undefined,
) {
  if (directory) {
    await app.register(staticPlugin, {
      serve: false,
      dotfiles: 'ignore',
      cacheControl: false,
      setHeaders(reply, path) {
        reply.setHeader(
          'Cache-Control',
          extname(path) !== '.html' &&
            /[-.][a-zA-Z0-9_-]{8,}\.[^.]+$/.test(path)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
        reply.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'",
        );
        reply.setHeader('X-Content-Type-Options', 'nosniff');
        reply.setHeader('Referrer-Policy', 'no-referrer');
      },
    });
  }
  app.setNotFoundHandler(async (request, response) => {
    if (
      (request.headers.origin && !auth.trustedOrigin(request)) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    )
      return response.code(403).send({ error: 'Invalid origin' });
    const file = directory && (await resolveStaticFile(directory, request));
    if (file) {
      response.removeHeader('Cache-Control');
      return response.sendFile(file.file, file.root);
    }
    return response.code(404).send({ error: 'Not found' });
  });
}
