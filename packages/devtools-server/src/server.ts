import { chmod, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import cookiePlugin from '@fastify/cookie';
import websocketPlugin from '@fastify/websocket';
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
} from '@soundor/devtools-protocol';
import Fastify from 'fastify';

import { createAuthentication } from './authentication';
import { registerBrowserRoutes } from './browser';
import { registerRuntimeRoutes } from './runtime';
import { createSession } from './session';
import { registerStaticRoutes } from './static';
import {
  DevToolsPortError,
  type DevToolsServer,
  type DevToolsServerOptions,
} from './types';
export { DevToolsPortError } from './types';
export type {
  DevToolsServer,
  DevToolsServerOptions,
  DevToolsConnection,
} from './types';

/** One session, one loopback HTTP port. All native I/O is asynchronous IPC. */
export async function startDevToolsServer(
  options: DevToolsServerOptions,
): Promise<DevToolsServer> {
  let port = options.port ?? 0;
  const auth = createAuthentication(options.developmentOrigin, () => port);
  const { sessionId, token, browserKey } = auth;
  const session = createSession(options);
  let closing = false;
  let descriptorPath = '';
  let descriptorDirectory = '';
  let closePromise: Promise<void> | undefined;
  const app = Fastify({
    bodyLimit: MAX_MESSAGE_BYTES,
    requestTimeout: 25000,
    forceCloseConnections: true,
    exposeHeadRoutes: false,
    routerOptions: {
      onBadUrl: (_path, _request, response) => {
        response.writeHead(404, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify({ error: 'Not found' }));
      },
    },
  });
  const http = app.server;
  http.headersTimeout = 10000;
  http.maxConnections = 128;
  // Native clients and the browser bootstrap also send JSON as text/plain or
  // without a Content-Type. Fastify still bounds and parses these payloads.
  app.removeAllContentTypeParsers();
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.addContentTypeParser(
    '*',
    { parseAs: 'string' },
    (request, body, done) => {
      if (body === '') done(null, undefined);
      else parseJson(request, body as string, done);
    },
  );
  app.setErrorHandler((_error, _request, reply) => {
    reply.code(400).send({ error: 'Invalid or oversized request' });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (closing) return reply.code(503).send({ error: 'Session closing' });
    if (!auth.trustedHost(request))
      return reply.code(403).send({ error: 'Invalid host' });
  });
  await app.register(cookiePlugin);
  await app.register(websocketPlugin, {
    options: { maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false },
  });

  await registerStaticRoutes(app, auth, options.staticDir);
  registerBrowserRoutes(app, auth, session, options);
  registerRuntimeRoutes(app, auth, session, options);
  for (;;) {
    try {
      await app.listen({ port, host: '127.0.0.1' });
      const address = http.address();
      if (address && typeof address !== 'string') port = address.port;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        await app.close();
        throw error;
      }
      if (!options.portFallback || port >= 65535) {
        await app.close();
        throw new DevToolsPortError(
          `DevTools port ${port} is occupied. Close the other listener or change devtools.port in your Soundor user config.`,
        );
      }
      port++;
    }
  }
  const url = `http://localhost:${port}`;
  http.on('error', () => {
    void close().catch(() => {});
  });
  app.websocketServer.on('error', () => {
    void close().catch(() => {});
  });
  const connection = { endpoint: `http://127.0.0.1:${port}`, sessionId, token };
  const heartbeat = setInterval(() => {
    const now = Date.now();
    auth.expireTickets(now);
    session.tick(now);
  }, session.heartbeatInterval);
  heartbeat.unref();
  async function close(): Promise<void> {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      closing = true;
      clearInterval(heartbeat);
      options.signal?.removeEventListener('abort', onAbort);
      session.close();
      auth.clear();
      await app.close();
      if (descriptorDirectory)
        await rm(descriptorDirectory, { recursive: true, force: true });
    })();
    return closePromise;
  }
  function onAbort(): void {
    void close();
  }
  try {
    const directory = await mkdtemp(join(tmpdir(), 'soundor-devtools-'));
    descriptorDirectory = directory;
    if (process.platform !== 'win32') await chmod(directory, 0o700);
    descriptorPath = join(directory, `${sessionId}.json`);
    const file = await open(descriptorPath, 'wx', 0o600);
    try {
      await file.writeFile(
        JSON.stringify({
          version: PROTOCOL_VERSION,
          project: options.projectRoot,
          browserKey,
          ...connection,
        }),
      );
    } finally {
      await file.close();
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) await close();
  } catch (error) {
    await close();
    throw error;
  }
  return {
    url,
    connection: { ...connection, descriptorPath },
    descriptorPath,
    browserLaunchUrl() {
      return `${url}/#connect=${auth.createTicket()}`;
    },
    close,
    publishLog: session.publishLog,
  };
}
