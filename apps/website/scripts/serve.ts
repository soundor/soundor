/**
 * Serves the built site (`dist/client`) as GitHub Pages does: a file, or a
 * folder's index.html, else 404. For the browser tests, and to look at a build
 * the way it will be deployed (`vite preview` serves it differently).
 *
 *   node scripts/serve.ts [port]
 */

import { createServer } from 'node:http';

import { serveFile } from './static.ts';

const ROOT = new URL('../dist/client/', import.meta.url).pathname;
const port = Number(process.argv[2] ?? 4321);
createServer((request, response) => {
  if (!serveFile(ROOT, request, response)) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(port, () =>
  console.log(`Serving dist/client on http://localhost:${port}/`),
);
