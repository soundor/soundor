import { randomUUID } from 'node:crypto';

import {
  PROTOCOL_VERSION,
  cancelSchema,
  helloSchema,
  requestSchema,
} from '@soundor/devtools-protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Authentication } from './authentication';
import type { Browser, Session } from './session';
import type { DevToolsServerOptions } from './types';

const MAX_CLIENTS = 32;

export function registerBrowserRoutes(
  app: FastifyInstance,
  auth: Authentication,
  session: Session,
  options: DevToolsServerOptions,
) {
  const {
    trustedOrigin,
    authenticatedBrowser,
    cookieName,
    browserToken,
    sessionId,
  } = auth;
  const {
    browsers,
    captures,
    pending,
    send,
    broadcastTargets,
    browserRequest,
    cancel,
    dropBrowser,
  } = session;
  app.post(
    '/browser/auth',
    {
      onRequest: async (request, response) => {
        if (!trustedOrigin(request))
          response.code(403).send({ error: 'Invalid origin' });
      },
    },
    async (request, response) => {
      const value = request.body as { key?: unknown };
      const key = typeof value?.key === 'string' ? value.key : undefined;
      if (!auth.consumeBrowserKey(key)) {
        response.code(401).send({ error: 'Invalid or expired browser key' });
        return;
      }
      response.setCookie(cookieName, browserToken, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      });
      response.code(200).send(null);
      return;
    },
  );
  app.get('/browser/session', async (request, response) => {
    if (request.headers.origin && !trustedOrigin(request)) {
      response.code(403).send({ error: 'Invalid origin' });
      return;
    }
    response.code(200).send({ authenticated: authenticatedBrowser(request) });
    return;
  });
  // Captures, for this session's signed-in clients only: their IDs are
  // unguessable, short-lived and never listed.
  function capture(
    request: FastifyRequest<{ Params: { id: string } }>,
    response: FastifyReply,
  ) {
    if (
      (request.headers.origin && !trustedOrigin(request)) ||
      !authenticatedBrowser(request)
    ) {
      response.code(403).send({ error: 'Browser authentication required' });
      return undefined;
    }
    const found = captures.get(request.params.id);
    if (!found || found.expires <= Date.now()) {
      captures.delete(request.params.id);
      response
        .code(404)
        .send({ error: 'No such capture; it may have expired' });
      return undefined;
    }
    return found;
  }
  app.get<{ Params: { id: string } }>(
    '/browser/captures/:id',
    async (request, response) => {
      const found = capture(request, response);
      if (!found) return;
      response
        .code(200)
        .header('Content-Type', 'image/png')
        .header('X-Content-Type-Options', 'nosniff')
        .send(found.data);
      return;
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/browser/captures/:id',
    async (request, response) => {
      if (!capture(request, response)) return;
      captures.delete(request.params.id);
      response.code(200).send(null);
      return;
    },
  );
  app.route({
    method: 'GET',
    url: '/browser',
    onRequest: async (request, response) => {
      if (
        request.raw.url !== '/browser' ||
        !trustedOrigin(request) ||
        !authenticatedBrowser(request) ||
        browsers.size >= MAX_CLIENTS
      )
        response.code(403).send({ error: 'Browser authentication required' });
    },
    handler: async (_request, response) => {
      response.code(404).send({ error: 'Not found' });
    },
    wsHandler: (socket) => {
      const browser: Browser = {
        id: randomUUID(),
        socket,
        negotiated: false,
        lastHeartbeat: Date.now(),
        subscriptions: new Map(),
      };
      browsers.set(browser.id, browser);
      send(browser, {
        type: 'hello',
        version: PROTOCOL_VERSION,
        sessionId,
        clientId: browser.id,
        project: options.projectRoot,
      });
      broadcastTargets();
      socket.on('pong', () => {
        if (browser.negotiated) browser.lastHeartbeat = Date.now();
      });
      socket.on('message', (raw) => {
        let value: unknown;
        try {
          value = JSON.parse(raw.toString());
        } catch {
          socket.close(1007, 'Invalid JSON');
          return;
        }
        if (!browser.negotiated) {
          if (!helloSchema.safeParse(value).success) {
            send(browser, {
              type: 'error',
              error: {
                code: 'PROTOCOL_MISMATCH',
                message: 'Send a hello with protocol version 1',
              },
            });
            socket.close(1002, 'Protocol mismatch');
            return;
          }
          browser.negotiated = true;
          return;
        }
        const cancelled = cancelSchema.safeParse(value);
        if (cancelled.success) {
          for (const [id, operation] of pending)
            if (
              operation.browser === browser &&
              operation.request.id === cancelled.data.id
            )
              cancel(id, { code: 'CANCELLED', message: 'Request cancelled' });
          return;
        }
        const parsed = requestSchema.safeParse(value);
        if (!parsed.success) {
          send(browser, {
            type: 'error',
            error: {
              code: 'INVALID_REQUEST',
              message: 'Invalid method or payload',
            },
          });
          return;
        }
        browserRequest(browser, parsed.data);
      });
      socket.on('error', () => dropBrowser(browser));
      socket.on('close', () => dropBrowser(browser));
    },
  });
}
