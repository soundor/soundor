import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { startDevToolsServer, type DevToolsServer } from './server';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'soundor-static-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const dist = join(root, 'dist');
  await mkdir(join(dist, 'assets/deep'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<html>Custom frontend</html>');
  await writeFile(join(dist, 'assets/chunk-a1234567.js'), 'export default 1');
  await writeFile(join(dist, 'assets/styles.css'), 'body{}');
  await writeFile(
    join(dist, 'assets/deep/module-a1234567.js'),
    'export default 2',
  );
  await writeFile(join(dist, 'assets/icon.svg'), '<svg/>');
  await writeFile(join(dist, 'assets/data.json'), '{}');
  await writeFile(
    join(dist, 'assets/image.webp'),
    new Uint8Array([0, 255, 1, 128]),
  );
  await writeFile(join(dist, 'assets/font.woff2'), 'font');
  await writeFile(join(dist, 'assets/renderer.wasm'), 'wasm');
  await writeFile(join(root, 'secret.txt'), 'private');
  await writeFile(join(dist, '.env'), 'private');
  await mkdir(join(dist, '.git'));
  await writeFile(join(dist, '.git/config'), 'private');
  await symlink(join(root, 'secret.txt'), join(dist, 'escape.txt'));
  await symlink(root, join(dist, 'outside'));
  await writeFile(join(dist, 'secret.key'), 'private');
  const server = await startDevToolsServer({
    projectRoot: root,
    staticDir: dist,
  });
  cleanup.push(() => server.close());
  return server;
}
function raw(server: DevToolsServer, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(server.connection.endpoint + '/', { path }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on('error', reject);
    req.end();
  });
}
it('serves arbitrary nested binary assets, MIME types, HEAD, caching and SPA navigation', async () => {
  const server = await setup();
  const index = await fetch(server.connection.endpoint + '/inspect/tree', {
    headers: { Accept: 'text/html' },
  });
  expect(await index.text()).toContain('Custom frontend');
  expect(index.headers.get('cache-control')).toBe('no-cache');
  expect(index.headers.get('content-security-policy')).toContain(
    "frame-ancestors 'none'",
  );
  for (const [file, mime] of [
    ['chunk-a1234567.js', 'text/javascript'],
    ['styles.css', 'text/css'],
    ['deep/module-a1234567.js', 'text/javascript'],
    ['icon.svg', 'image/svg+xml'],
    ['data.json', 'application/json'],
    ['image.webp', 'image/webp'],
    ['font.woff2', 'font/woff2'],
    ['renderer.wasm', 'application/wasm'],
  ]) {
    const response = await fetch(
      server.connection.endpoint + '/assets/' + file,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(mime);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  }
  const binary = await fetch(server.connection.endpoint + '/assets/image.webp');
  expect(new Uint8Array(await binary.arrayBuffer())).toEqual(
    new Uint8Array([0, 255, 1, 128]),
  );
  const head = await fetch(
    server.connection.endpoint + '/assets/chunk-a1234567.js',
    { method: 'HEAD' },
  );
  expect(await head.text()).toBe('');
  expect(head.headers.get('content-length')).toBe('16');
  expect(head.headers.get('cache-control')).toContain('immutable');
});
it('rejects traversal, symlinks, hidden files, missing resources and API fallbacks', async () => {
  const server = await setup();
  for (const path of [
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/%252e%252e/secret.txt',
    '/assets/../../secret.txt',
    '/escape.txt',
    '/outside/missing',
    '/secret.key',
    '/%252e%252e/navigation',
    '/.env',
    '/.git/config',
    '/%2egit/config',
    '/%00',
    '/%zz',
    '/assets/missing.js',
    '/assets/missing',
    '/missing.css',
    '/api/unknown',
  ])
    expect(await raw(server, path)).toBe(404);
  for (const path of ['/browser/missing', '/runtime/missing']) {
    const response = await fetch(server.connection.endpoint + path);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.text()).not.toContain('<html>');
  }
  expect(await raw(server, '/%5c..%5csecret.txt')).toBe(404);
  expect(
    (await fetch(server.connection.endpoint, { method: 'POST' })).status,
  ).toBe(404);
});
it('runs the complete backend headlessly and permits only an explicit development origin', async () => {
  const server = await startDevToolsServer({
    projectRoot: '/project',
    developmentOrigin: 'http://127.0.0.1:5173',
  });
  cleanup.push(() => server.close());
  expect((await fetch(server.connection.endpoint)).status).toBe(404);
  const ticket = new URL(server.browserLaunchUrl()).hash.slice(
    '#connect='.length,
  );
  for (const origin of ['http://evil.test', 'http://127.0.0.1:5174']) {
    expect(
      (
        await fetch(server.connection.endpoint + '/browser/auth', {
          method: 'POST',
          headers: { Origin: origin },
          body: JSON.stringify({ key: ticket }),
        })
      ).status,
    ).toBe(403);
  }
  expect(
    (
      await fetch(server.connection.endpoint + '/browser/auth', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:5173' },
        body: JSON.stringify({ key: ticket }),
      })
    ).status,
  ).toBe(200);
  await expect(
    startDevToolsServer({
      projectRoot: '/',
      developmentOrigin: 'http://evil.test',
    }),
  ).rejects.toThrow('loopback');
});
